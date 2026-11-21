import { describe, expect, it } from 'vitest';
import { HttpCountriesClient } from '../src/clients/countries.client.js';
import { ExternalApiError } from '../src/errors/external-api-error.js';

const worldBankBody = [
  { page: 1, pages: 1, per_page: '50', total: 1 },
  [
    {
      id: 'COL',
      iso2Code: 'CO',
      name: 'Colombia',
      region: { id: 'LCN', value: 'Latin America & Caribbean ' },
      incomeLevel: { id: 'UMC', value: 'Upper middle income' },
      capitalCity: 'Bogota',
    },
  ],
];

/** fetch stub que devuelve las respuestas en orden y cuenta las llamadas. */
function stubFetch(...responses: Array<() => Response | Promise<Response>>) {
  const stub = Object.assign(
    async () => {
      const next = responses[stub.calls++];
      if (!next) throw new Error('Llamada inesperada a fetch');
      return next();
    },
    { calls: 0 },
  );
  return stub;
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

function client(fetchFn: typeof fetch, timeoutMs = 1000) {
  return new HttpCountriesClient({ baseUrl: 'http://countries.test', timeoutMs, fetchFn });
}

async function captureError(promise: Promise<unknown>): Promise<ExternalApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExternalApiError);
  return error as ExternalApiError;
}

describe('HttpCountriesClient', () => {
  it('reintenta una vez ante un 500 y luego tiene éxito', async () => {
    const fetchFn = stubFetch(json({ error: 'boom' }, 500), json(worldBankBody));

    const country = await client(fetchFn).getCountry('CO');

    expect(fetchFn.calls).toBe(2);
    expect(country).toEqual({
      name: 'Colombia',
      region: 'Latin America & Caribbean',
      capital: 'Bogota',
      incomeLevel: 'Upper middle income',
    });
  });

  it('no reintenta ante un 404', async () => {
    const fetchFn = stubFetch(json({}, 404));

    const error = await captureError(client(fetchFn).getCountry('CO'));

    expect(error.reason).toBe('NOT_FOUND');
    expect(fetchFn.calls).toBe(1);
  });

  it('lanza ExternalApiError con reason TIMEOUT si la API no responde a tiempo', async () => {
    // Simula una API colgada: solo termina cuando el AbortSignal del cliente se dispara.
    const hang = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const fetchFn = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        fetchFn.calls++;
        return hang(input, init);
      },
      { calls: 0 },
    );

    const error = await captureError(client(fetchFn, 20).getCountry('CO'));

    expect(error.reason).toBe('TIMEOUT');
    expect(fetchFn.calls).toBe(2);
  });

  it('devuelve INVALID_RESPONSE si la respuesta no tiene la forma esperada', async () => {
    const fetchFn = stubFetch(json({ unexpected: true }));

    const error = await captureError(client(fetchFn).getCountry('CO'));

    expect(error.reason).toBe('INVALID_RESPONSE');
  });
});
