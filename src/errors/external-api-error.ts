import type { EnrichmentFailureReason } from '../domain/validation.js';

export class ExternalApiError extends Error {
  constructor(
    readonly reason: EnrichmentFailureReason,
    readonly retryable = false,
  ) {
    super(`External API error: ${reason}`);
    this.name = 'ExternalApiError';
  }
}
