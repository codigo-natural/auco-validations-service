import 'dotenv/config';
import { HttpCountriesClient } from './clients/countries.client.js';
import { loadEnv } from './config/env.js';
import { createApp } from './http/app.js';
import { createDocumentClient, createDynamoClient } from './infra/dynamo.js';
import { connectMongo } from './infra/mongo.js';
import { DynamoAuditRepository } from './repositories/dynamo-audit.repository.js';
import { MongoValidationRepository } from './repositories/mongo-validation.repository.js';
import { ValidationService } from './services/validation.service.js';

const env = loadEnv();

const mongo = await connectMongo(env.MONGO_URI, env.MONGO_DB_NAME).catch((error: unknown) => {
  console.error(
    `No se pudo conectar a MongoDB en ${env.MONGO_URI}. ¿Corriste docker compose up -d?`,
  );
  throw error;
});
const dynamoClient = createDynamoClient({
  endpoint: env.DYNAMO_ENDPOINT,
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
});

const validationService = new ValidationService({
  validations: new MongoValidationRepository(mongo.db),
  audit: new DynamoAuditRepository(createDocumentClient(dynamoClient), env.AUDIT_TABLE_NAME),
  countries: new HttpCountriesClient({
    baseUrl: env.COUNTRIES_API_URL,
    timeoutMs: env.EXTERNAL_API_TIMEOUT_MS,
  }),
});

const app = createApp({ validationService });
const server = app.listen(env.PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${env.PORT}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recibido, cerrando...`);
  server.close(async () => {
    await mongo.client.close();
    dynamoClient.destroy();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
