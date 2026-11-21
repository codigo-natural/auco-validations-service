import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createApp } from './http/app.js';

const env = loadEnv();
const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${env.PORT}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} recibido, cerrando...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
