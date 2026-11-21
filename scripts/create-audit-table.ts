import 'dotenv/config';
import {
  CreateTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { loadEnv } from '../src/config/env.js';
import { createDynamoClient } from '../src/infra/dynamo.js';

const env = loadEnv();
const client = createDynamoClient({
  endpoint: env.DYNAMO_ENDPOINT,
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
});
const tableName = env.AUDIT_TABLE_NAME;

try {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
  console.log(`Tabla "${tableName}" creada.`);
} catch (error) {
  if (error instanceof ResourceInUseException) {
    console.log(`La tabla "${tableName}" ya existe. Nada que hacer.`);
  } else {
    console.error(`No se pudo crear la tabla "${tableName}":`, error);
    process.exitCode = 1;
  }
} finally {
  client.destroy();
}
