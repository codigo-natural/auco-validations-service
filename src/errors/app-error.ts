export type ErrorCode =
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'INVALID_ID' | 'PERSISTENCE_ERROR' | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
