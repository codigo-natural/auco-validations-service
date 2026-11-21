export type EnrichmentFailureReason =
  'TIMEOUT' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE';

export interface CountryInfo {
  name: string;
  region: string;
  capital: string | null;
  incomeLevel: string;
}

export type Enrichment =
  | { status: 'completed'; country: CountryInfo }
  | { status: 'failed'; reason: EnrichmentFailureReason };

export interface RiskSignal {
  /** Eventos de auditoría del mismo documento en las 24 horas previas a esta validación. */
  previousAttempts24h: number;
  flagged: boolean;
}

export interface NewValidation {
  name: string;
  documentNumber: string;
  country: string;
  enrichment: Enrichment;
  risk: RiskSignal;
  createdAt: Date;
}

export interface Validation extends NewValidation {
  id: string;
}

export interface AuditEvent {
  eventType: 'VALIDATION_CREATED';
  validationId: string;
  documentNumber: string;
  country: string;
  enrichmentStatus: Enrichment['status'];
  createdAt: Date;
}

export interface ValidationRepository {
  insert(record: NewValidation): Promise<string>;
  findById(id: string): Promise<Validation | null>;
  deleteById(id: string): Promise<void>;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
  /** Cuenta los eventos de un documento con createdAt en [from, to]. */
  countBetween(documentNumber: string, from: Date, to: Date): Promise<number>;
}

export interface CountriesClient {
  getCountry(code: string): Promise<CountryInfo>;
}
