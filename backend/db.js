import { MongoClient, ServerApiVersion } from "mongodb";

let client;

export async function connectToDatabase() {
  if (client) return client;

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<db_username>")) {
    throw new Error("MONGODB_URI is not set with credentials");
  }

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true
    }
  });

  await client.connect();
  await client.db().command({ ping: 1 });
  console.log("Connected to MongoDB");
  return client;
}

export function getDb() {
  if (!client) {
    throw new Error("MongoDB client not initialized. Call connectToDatabase() first.");
  }
  return client.db();
}
