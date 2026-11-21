import type {
  AuditEvent,
  AuditRepository,
  CountriesClient,
  Enrichment,
  NewValidation,
  RiskSignal,
  Validation,
  ValidationRepository,
} from '../domain/validation.js';
import { AppError } from '../errors/app-error.js';
import { ExternalApiError } from '../errors/external-api-error.js';

const RISK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Con 3 o más intentos previos del mismo documento en 24 h, la validación se marca para revisión. */
export const RISK_FLAG_THRESHOLD = 3;

export interface CreateValidationInput {
  name: string;
  documentNumber: string;
  country: string;
}

export interface ValidationServiceDeps {
  validations: ValidationRepository;
  audit: AuditRepository;
  countries: CountriesClient;
}

export class ValidationService {
  constructor(private readonly deps: ValidationServiceDeps) {}

  async create(input: CreateValidationInput): Promise<string> {
    const createdAt = new Date();
    const risk = await this.assessRisk(input.documentNumber, createdAt);
    const enrichment = await this.enrich(input.country);
    const record: NewValidation = { ...input, enrichment, risk, createdAt };

    let id: string;
    try {
      id = await this.deps.validations.insert(record);
    } catch (error) {
      logFailure('No se pudo guardar la validación en Mongo', error);
      throw persistenceError();
    }

    const event: AuditEvent = {
      eventType: 'VALIDATION_CREATED',
      validationId: id,
      documentNumber: input.documentNumber,
      country: input.country,
      enrichmentStatus: enrichment.status,
      createdAt,
    };

    // No hay transacción distribuida entre Mongo y Dynamo: si la auditoría falla, se compensa borrando en Mongo.
    try {
      await this.recordAuditWithRetry(event);
    } catch (error) {
      logFailure(`Falló la auditoría de la validación ${id}, compensando`, error);
      await this.compensate(id);
      throw persistenceError();
    }

    return id;
  }

  async getById(id: string): Promise<Validation> {
    const validation = await this.deps.validations.findById(id);
    if (!validation) throw new AppError(404, 'NOT_FOUND', 'Validación no encontrada');
    return validation;
  }

  // Usa el patrón de acceso de la tabla de auditoría: Query por DOC# con sk BETWEEN.
  // Si Dynamo no responde se corta aquí: sin Dynamo tampoco se podría auditar.
  private async assessRisk(documentNumber: string, now: Date): Promise<RiskSignal> {
    let previousAttempts24h: number;
    try {
      const since = new Date(now.getTime() - RISK_WINDOW_MS);
      previousAttempts24h = await this.deps.audit.countBetween(documentNumber, since, now);
    } catch (error) {
      logFailure('No se pudo consultar el historial de auditoría', error);
      throw persistenceError();
    }
    return { previousAttempts24h, flagged: previousAttempts24h >= RISK_FLAG_THRESHOLD };
  }

  private async enrich(countryCode: string): Promise<Enrichment> {
    // Decisión de negocio: la caída de un tercero no bloquea la creación de la validación.
    try {
      const country = await this.deps.countries.getCountry(countryCode);
      return { status: 'completed', country };
    } catch (error) {
      const reason = error instanceof ExternalApiError ? error.reason : 'UPSTREAM_ERROR';
      return { status: 'failed', reason };
    }
  }

  private async recordAuditWithRetry(event: AuditEvent): Promise<void> {
    try {
      await this.deps.audit.record(event);
    } catch {
      await this.deps.audit.record(event);
    }
  }

  private async compensate(id: string): Promise<void> {
    try {
      await this.deps.validations.deleteById(id);
    } catch (error) {
      logFailure(`La compensación falló: la validación ${id} quedó sin auditoría`, error);
    }
  }
}

function persistenceError(): AppError {
  return new AppError(
    503,
    'PERSISTENCE_ERROR',
    'No se pudo persistir la validación, intenta de nuevo',
  );
}

// Solo se registra el tipo y mensaje del error, nunca los datos de la solicitud.
function logFailure(context: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const detail =
    error instanceof Error
      ? `${error.name}${code ? ` (${String(code)})` : ''}: ${error.message}`
      : String(error);
  console.error(`${context}. ${detail}`);
}
