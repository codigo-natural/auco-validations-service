import { z } from 'zod';
import type { CountriesClient, CountryInfo } from '../domain/validation.js';
import { ExternalApiError } from '../errors/external-api-error.js';

const RETRY_DELAY_MS = 300;

// Forma mínima que necesitamos de la API del Banco Mundial; el resto de campos se ignora.
const countrySchema = z.object({
  name: z.string().min(1),
  region: z.object({ value: z.string() }),
  capitalCity: z.string(),
  incomeLevel: z.object({ value: z.string() }),
});
const successSchema = z.tuple([z.object({ total: z.number() }), z.array(countrySchema).min(1)]);
// Un código desconocido responde 200 con este cuerpo en lugar de un 404.
const notFoundSchema = z.tuple([z.object({ message: z.array(z.unknown()).min(1) })]);

export interface CountriesClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpCountriesClient implements CountriesClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor({
    baseUrl,
    timeoutMs,
    fetchFn = (input, init) => fetch(input, init),
  }: CountriesClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
  }

  async getCountry(code: string): Promise<CountryInfo> {
    const url = `${this.baseUrl}/country/${encodeURIComponent(code)}?format=json`;
    return toCountryInfo(await this.requestWithRetry(url));
  }

  private async requestWithRetry(url: string): Promise<unknown> {
    try {
      return await this.request(url);
    } catch (error) {
      if (!(error instanceof ExternalApiError) || !error.retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return this.request(url);
    }
  }

  private async request(url: string): Promise<unknown> {
    try {
      const response = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) throw new ExternalApiError('NOT_FOUND');
      if (response.status === 429 || response.status >= 500) {
        throw new ExternalApiError('UPSTREAM_ERROR', true);
      }
      if (!response.ok) throw new ExternalApiError('UPSTREAM_ERROR');
      try {
        return await response.json();
      } catch (error) {
        if (isTimeout(error)) throw error;
        throw new ExternalApiError('INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof ExternalApiError) throw error;
      if (isTimeout(error)) throw new ExternalApiError('TIMEOUT', true);
      // Error de red (DNS, conexión rechazada, socket cerrado...).
      throw new ExternalApiError('UPSTREAM_ERROR', true);
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function toCountryInfo(body: unknown): CountryInfo {
  if (notFoundSchema.safeParse(body).success) throw new ExternalApiError('NOT_FOUND');

  const parsed = successSchema.safeParse(body);
  if (!parsed.success) throw new ExternalApiError('INVALID_RESPONSE');

  const [, [country]] = parsed.data;
  // Los agregados regionales (EU, ZJ...) tienen código de dos letras pero no son países.
  if (!country || country.region.value === 'Aggregates') throw new ExternalApiError('NOT_FOUND');

  return {
    name: country.name,
    region: country.region.value.trim(),
    capital: country.capitalCity.trim() || null,
    incomeLevel: country.incomeLevel.value.trim(),
  };
}
