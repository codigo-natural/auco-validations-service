import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AuditEvent, AuditRepository } from '../domain/validation.js';

export interface AuditItem {
  pk: string;
  sk: string;
  eventType: AuditEvent['eventType'];
  validationId: string;
  documentNumber: string;
  country: string;
  enrichmentStatus: AuditEvent['enrichmentStatus'];
  createdAt: string;
}

/**
 * pk = DOC#{documento}: agrupa el historial de un documento.
 * sk = {ISO 8601 UTC}#{validationId}: ordena cronológicamente y evita colisiones en el mismo milisegundo.
 * El nombre no se guarda (minimización de datos personales).
 */
export function toAuditItem(event: AuditEvent): AuditItem {
  const createdAt = event.createdAt.toISOString();
  return {
    pk: `DOC#${event.documentNumber}`,
    sk: `${createdAt}#${event.validationId}`,
    eventType: event.eventType,
    validationId: event.validationId,
    documentNumber: event.documentNumber,
    country: event.country,
    enrichmentStatus: event.enrichmentStatus,
    createdAt,
  };
}

export class DynamoAuditRepository implements AuditRepository {
  constructor(
    private readonly docClient: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: toAuditItem(event),
          // Un evento de auditoría nunca se sobrescribe.
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      // La sk incluye el validationId: si ya existe, es este mismo evento (p. ej. un reintento
      // cuyo primer intento sí se escribió). Se considera registrado, no se sobrescribe.
      if (error instanceof ConditionalCheckFailedException) return;
      throw error;
    }
  }
}
