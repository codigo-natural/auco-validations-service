import express, { type Express, type RequestHandler } from 'express';
import type { ValidationService } from '../services/validation.service.js';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { validationsRouter } from './validations.routes.js';

export interface AppDeps {
  validationService: ValidationService;
}

// Registra método, ruta, status y duración. Nunca el body ni el query string.
const requestLogger: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const ms = (performance.now() - start).toFixed(1);
    console.log(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
  });
  next();
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/validations', validationsRouter(deps.validationService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
