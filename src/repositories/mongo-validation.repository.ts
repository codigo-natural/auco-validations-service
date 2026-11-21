import { ObjectId, type Collection, type Db } from 'mongodb';
import type { NewValidation, Validation, ValidationRepository } from '../domain/validation.js';

type ValidationDocument = NewValidation & { _id?: ObjectId };

export class MongoValidationRepository implements ValidationRepository {
  private readonly collection: Collection<ValidationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ValidationDocument>('validations');
  }

  async insert(record: NewValidation): Promise<string> {
    // Se copia el objeto: insertOne muta su argumento agregándole _id.
    const result = await this.collection.insertOne({ ...record });
    return result.insertedId.toHexString();
  }

  async findById(id: string): Promise<Validation | null> {
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id.toHexString(), ...rest };
  }

  async deleteById(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}
