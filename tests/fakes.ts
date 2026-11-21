import { randomBytes } from 'node:crypto';
import type {
  AuditEvent,
  AuditRepository,
  CountriesClient,
  CountryInfo,
  NewValidation,
  Validation,
  ValidationRepository,
} from '../src/domain/validation.js';
import { toAuditItem, type AuditItem } from '../src/repositories/dynamo-audit.repository.js';

export class InMemoryValidationRepository implements ValidationRepository {
  readonly records = new Map<string, NewValidation>();

  async insert(record: NewValidation): Promise<string> {
    const id = randomBytes(12).toString('hex');
    this.records.set(id, structuredClone(record));
    return id;
  }

  async findById(id: string): Promise<Validation | null> {
    const record = this.records.get(id);
    return record ? { id, ...structuredClone(record) } : null;
  }

  async deleteById(id: string): Promise<void> {
    this.records.delete(id);
  }
}

/** Guarda los ítems tal como los construiría el repositorio de Dynamo, para verificar pk y sk. */
export class InMemoryAuditRepository implements AuditRepository {
  readonly items: AuditItem[] = [];
  attempts = 0;
  failuresLeft = 0;

  async record(event: AuditEvent): Promise<void> {
    this.attempts++;
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error('Dynamo no disponible');
    }
    this.items.push(toAuditItem(event));
  }
}

export const COLOMBIA: CountryInfo = {
  name: 'Colombia',
  region: 'Latin America & Caribbean',
  capital: 'Bogota',
  incomeLevel: 'Upper middle income',
};

export class FakeCountriesClient implements CountriesClient {
  error: Error | null = null;

  async getCountry(): Promise<CountryInfo> {
    if (this.error) throw this.error;
    return COLOMBIA;
  }
}
