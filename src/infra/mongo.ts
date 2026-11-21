import { MongoClient, type Db } from 'mongodb';

export async function connectMongo(
  uri: string,
  dbName: string,
): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  return { client, db: client.db(dbName) };
}
