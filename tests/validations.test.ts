import request from 'supertest';
import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import { ExternalApiError } from '../src/errors/external-api-error.js';
import { createApp } from '../src/http/app.js';
import { toAuditItem } from '../src/repositories/dynamo-audit.repository.js';
import { RISK_FLAG_THRESHOLD, ValidationService } from '../src/services/validation.service.js';
import {
  COLOMBIA,
  FakeCountriesClient,
  InMemoryAuditRepository,
  InMemoryValidationRepository,
} from './fakes.js';

const validBody = { name: '  José   Pérez ', documentNumber: '1.234.567', country: 'co' };

function setup() {
  const validations = new InMemoryValidationRepository();
  const audit = new InMemoryAuditRepository();
  const countries = new FakeCountriesClient();
  const app = createApp({
    validationService: new ValidationService({ validations, audit, countries }),
  });
  return { app, validations, audit, countries };
}

beforeEach(() => {
  // Silencia el log de peticiones y errores esperados.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /validations', () => {
  it('crea la validación, normaliza la entrada y escribe la auditoría', async () => {
    const { app, validations, audit } = setup();

    const res = await request(app).post('/validations').send(validBody);

    expect(res.status).toBe(201);
    const { id } = res.body;
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.headers.location).toBe(`/validations/${id}`);

    const record = validations.records.get(id);
    expect(record).toMatchObject({
      name: 'José Pérez',
      documentNumber: '1234567',
      country: 'CO',
      enrichment: { status: 'completed', country: COLOMBIA },
    });

    expect(audit.items).toHaveLength(1);
    const [item] = audit.items;
    expect(item?.pk).toBe('DOC#1234567');
    expect(item?.sk.startsWith(record!.createdAt.toISOString())).toBe(true);
    expect(item?.sk.endsWith(`#${id}`)).toBe(true);
    expect(item).toMatchObject({
      eventType: 'VALIDATION_CREATED',
      validationId: id,
      enrichmentStatus: 'completed',
    });
    expect(item).not.toHaveProperty('name');
  });

  test.each([
    ['documento con letras', { documentNumber: '12ab5678' }, 'documentNumber'],
    ['nombre vacío', { name: '' }, 'name'],
    ['country de tres letras', { country: 'COL' }, 'country'],
  ])('responde 400 VALIDATION_ERROR con %s', async (_case, override, field) => {
    const { app, validations, audit } = setup();

    const res = await request(app)
      .post('/validations')
      .send({ ...validBody, ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: field })]),
    );
    expect(validations.records.size).toBe(0);
    expect(audit.items).toHaveLength(0);
  });

  it('responde 400 ante un JSON mal formado', async () => {
    const { app } = setup();

    const res = await request(app)
      .post('/validations')
      .set('content-type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('crea la validación con enrichment failed si la API externa falla', async () => {
    const { app, validations, audit, countries } = setup();
    countries.error = new ExternalApiError('TIMEOUT', true);

    const res = await request(app).post('/validations').send(validBody);

    expect(res.status).toBe(201);
    expect(validations.records.get(res.body.id)?.enrichment).toEqual({
      status: 'failed',
      reason: 'TIMEOUT',
    });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]?.enrichmentStatus).toBe('failed');
  });

  it('reintenta la auditoría una vez y responde 201 si el reintento funciona', async () => {
    const { app, validations, audit } = setup();
    audit.failuresLeft = 1;

    const res = await request(app).post('/validations').send(validBody);

    expect(res.status).toBe(201);
    expect(audit.attempts).toBe(2);
    expect(validations.records.has(res.body.id)).toBe(true);
  });

  it('responde 503 y compensa borrando en Mongo si la auditoría falla dos veces', async () => {
    const { app, validations, audit } = setup();
    audit.failuresLeft = 2;

    const res = await request(app).post('/validations').send(validBody);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PERSISTENCE_ERROR');
    expect(audit.attempts).toBe(2);
    expect(validations.records.size).toBe(0);
  });
});

describe('GET /validations/:id', () => {
  it('responde 404 si el id no existe', async () => {
    const { app } = setup();

    const res = await request(app).get('/validations/000000000000000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test.each(['abc', '123456789012', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'responde 400 INVALID_ID con el id mal formado "%s"',
    async (id) => {
      const { app } = setup();

      const res = await request(app).get(`/validations/${id}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    },
  );

  it('responde 200 con el registro guardado', async () => {
    const { app, validations } = setup();
    const { body: created } = await request(app).post('/validations').send(validBody);

    const res = await request(app).get(`/validations/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: created.id,
      name: 'José Pérez',
      documentNumber: '1234567',
      country: 'CO',
      enrichment: { status: 'completed', country: COLOMBIA },
      risk: { previousAttempts24h: 0, flagged: false },
      createdAt: validations.records.get(created.id)!.createdAt.toISOString(),
    });
  });
});

describe('Señal de riesgo por intentos repetidos', () => {
  const HOUR = 60 * 60 * 1000;

  function pastEvent(documentNumber: string, msAgo: number, validationId: string) {
    return toAuditItem({
      eventType: 'VALIDATION_CREATED',
      validationId,
      documentNumber,
      country: 'CO',
      enrichmentStatus: 'completed',
      createdAt: new Date(Date.now() - msAgo),
    });
  }

  it('cuenta los intentos previos del documento y marca la validación al llegar al umbral', async () => {
    const { app, validations } = setup();
    const risks = [];

    for (let i = 0; i <= RISK_FLAG_THRESHOLD; i++) {
      const res = await request(app).post('/validations').send(validBody);
      expect(res.status).toBe(201);
      risks.push(validations.records.get(res.body.id)?.risk);
    }

    expect(risks).toEqual([
      { previousAttempts24h: 0, flagged: false },
      { previousAttempts24h: 1, flagged: false },
      { previousAttempts24h: 2, flagged: false },
      { previousAttempts24h: 3, flagged: true },
    ]);
  });

  it('ignora eventos de más de 24 horas y de otros documentos', async () => {
    const { app, validations, audit } = setup();
    audit.items.push(
      pastEvent('1234567', 25 * HOUR, 'a'.repeat(24)), // fuera de la ventana
      pastEvent('1234567', 23 * HOUR, 'b'.repeat(24)), // dentro de la ventana
      pastEvent('7654321', 1 * HOUR, 'c'.repeat(24)), // otro documento
    );

    const res = await request(app).post('/validations').send(validBody);

    expect(validations.records.get(res.body.id)?.risk).toEqual({
      previousAttempts24h: 1,
      flagged: false,
    });
  });

  it('responde 503 sin guardar nada si no puede consultar el historial', async () => {
    const { app, validations, audit } = setup();
    audit.failQueries = true;

    const res = await request(app).post('/validations').send(validBody);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PERSISTENCE_ERROR');
    expect(validations.records.size).toBe(0);
    expect(audit.items).toHaveLength(0);
  });
});
