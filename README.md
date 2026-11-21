# AUCO Validations

Servicio en Node.js que registra validaciones de identidad (nombre y documento), las enriquece con datos del país consultando una API pública, las guarda en MongoDB y escribe un evento de auditoría en DynamoDB.
Expone `POST /validations` para crear y `GET /validations/:id` para consultar.

## Requisitos

- Node.js 22 o superior
- Docker (solo para MongoDB y DynamoDB Local; la app corre con npm)

## Cómo correrlo

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:setup   # crea la tabla de auditoría (idempotente)
npm run dev        # http://localhost:3000
```

Las credenciales `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` del `.env` son dummy, pero obligatorias: sin ellas DynamoDB Local falla con un error confuso. DynamoDB Local corre en memoria, así que si reinicias el contenedor debes volver a ejecutar `npm run db:setup`.

## Ejemplos

**POST válido** (201, con header `Location: /validations/{id}`):

```bash
curl -i -X POST http://localhost:3000/validations \
  -H 'content-type: application/json' \
  -d '{"name":"José Pérez","documentNumber":"1.234.567","country":"CO"}'
```

```json
{ "id": "6b01111ed9073c3371852781" }
```

**POST inválido** (400):

```bash
curl -X POST http://localhost:3000/validations \
  -H 'content-type: application/json' \
  -d '{"name":"","documentNumber":"12ab","country":"COL"}'
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "El cuerpo de la solicitud es inválido",
    "details": [
      { "path": "name", "message": "Debe tener al menos 3 caracteres" },
      { "path": "documentNumber", "message": "Debe tener entre 6 y 10 dígitos" },
      { "path": "country", "message": "Debe ser un código ISO 3166-1 alpha-2 de dos letras" }
    ]
  }
}
```

**GET** (200; 404 si no existe, 400 si el id no tiene 24 caracteres hexadecimales):

```bash
curl http://localhost:3000/validations/6b01111ed9073c3371852781
```

```json
{
  "id": "6b01111ed9073c3371852781",
  "name": "José Pérez",
  "documentNumber": "1234567",
  "country": "CO",
  "enrichment": {
    "status": "completed",
    "country": {
      "name": "Colombia",
      "region": "Latin America & Caribbean",
      "capital": "Bogota",
      "incomeLevel": "Upper middle income"
    }
  },
  "createdAt": "2026-11-21T03:33:50.431Z"
}
```

Reglas de entrada: `name` se recorta y se colapsan espacios (3 a 100 caracteres, solo letras, espacios, apóstrofo y guion); `documentNumber` se normaliza quitando puntos, espacios y guiones (6 a 10 dígitos). `country` es un **campo opcional añadido** para tener algo concreto que enriquecer: código ISO 3166-1 alpha-2, se pasa a mayúsculas y por defecto es `CO`.

Todos los errores tienen la forma `{ error: { code, message, details? } }`, con `code` en `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_ID`, `PERSISTENCE_ERROR` o `INTERNAL_ERROR`.

## Pruebas

```bash
npm test
```

No necesitan Docker ni red: `createApp` recibe las dependencias, y las pruebas le inyectan repositorios en memoria y un cliente de países fake. El cliente HTTP se prueba con un `fetch` stub.

## Decisiones de diseño

- **Express y no NestJS:** es un servicio de dos endpoints; Express mantiene poco código y queda cerca de lo que sería un handler de Lambda. Las dependencias se inyectan a mano en `src/server.ts` (composition root).
- **API externa:** el enunciado sugería restcountries, pero su v3.1 fue retirada (responde siempre un error de deprecación) y la v5 exige API key. Se usa la API pública del Banco Mundial (`api.worldbank.org/v2/country/{iso2}`), gratuita y sin registro, que aporta nombre, región, capital y nivel de ingreso.
- **Si falla la API externa:** la validación se crea igual con `enrichment: { status: "failed", reason }` (`TIMEOUT`, `NOT_FOUND`, `UPSTREAM_ERROR` o `INVALID_RESPONSE`). La caída de un tercero no bloquea el negocio. Cada llamada tiene timeout y un único reintento (300 ms) solo ante error de red, timeout, 5xx o 429.
- **Consistencia Mongo/Dynamo:** no hay transacción distribuida. Se inserta en Mongo, luego se audita en Dynamo con un reintento; si vuelve a fallar se borra el documento de Mongo (compensación) y se responde 503 `PERSISTENCE_ERROR`. Nunca queda una validación sin auditoría.
- **Llaves de DynamoDB:** `pk = DOC#{documento}` y `sk = {createdAt ISO 8601 UTC}#{validationId}`. El patrón de acceso es "historial de un documento en un rango de fechas" (`Query` por `pk` con `sk BETWEEN`), útil para detectar intentos repetidos con el mismo documento, una señal típica de fraude. ISO 8601 ordena cronológicamente como texto, y el sufijo `validationId` evita colisiones si dos eventos del mismo documento caen en el mismo milisegundo (con solo la fecha, `PutItem` sobrescribiría eventos). El `PutItem` usa `attribute_not_exists(pk)` para que un evento nunca se sobrescriba.
- **Minimización de datos personales:** la auditoría no guarda el nombre, solo lo necesario para el patrón de acceso. Los logs registran método, ruta, status y duración; nunca bodies, nombres ni documentos.

## Verificar la auditoría

Con la app corriendo y después de crear una validación con el documento `1.234.567`:

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
aws dynamodb query \
  --endpoint-url http://localhost:8000 --region us-east-1 \
  --table-name validation_audit \
  --key-condition-expression 'pk = :pk AND sk BETWEEN :from AND :to' \
  --expression-attribute-values '{":pk":{"S":"DOC#1234567"},":from":{"S":"2026-01-01"},":to":{"S":"2099-12-31"}}'
```

## Respuestas de la entrega
