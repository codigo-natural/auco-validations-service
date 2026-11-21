import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // Errores de express.json (body-parser): JSON mal formado o cuerpo mayor a 10kb.
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON mal formado' } });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'VALIDATION_ERROR', message: 'El cuerpo excede el tamaño máximo (10kb)' },
    });
    return;
  }

  console.error('Error no controlado:', err instanceof Error ? err.stack : err);
  res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
};
