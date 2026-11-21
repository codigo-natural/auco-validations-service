import { Router } from 'express';
import type { Validation } from '../domain/validation.js';
import type { ValidationService } from '../services/validation.service.js';
import { createValidationSchema, idParamsSchema, parseOrThrow } from './schemas.js';

export function validationsRouter(service: ValidationService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parseOrThrow(
      createValidationSchema,
      req.body,
      'VALIDATION_ERROR',
      'El cuerpo de la solicitud es inválido',
    );
    const id = await service.create(input);
    res.status(201).location(`/validations/${id}`).json({ id });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params, 'INVALID_ID', 'El id es inválido');
    const validation = await service.getById(id);
    res.status(200).json(toResponse(validation));
  });

  return router;
}

function toResponse(validation: Validation) {
  return {
    id: validation.id,
    name: validation.name,
    documentNumber: validation.documentNumber,
    country: validation.country,
    enrichment: validation.enrichment,
    risk: validation.risk,
    createdAt: validation.createdAt.toISOString(),
  };
}
