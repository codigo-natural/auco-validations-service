import type {
  AuditEvent,
  AuditRepository,
  CountriesClient,
  Enrichment,
  NewValidation,
  Validation,
  ValidationRepository,
} from '../domain/validation.js';
import { AppError } from '../errors/app-error.js';
import { ExternalApiError } from '../errors/external-api-error.js';

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
    const enrichment = await this.enrich(input.country);
    const createdAt = new Date();
    const record: NewValidation = { ...input, enrichment, createdAt };

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
