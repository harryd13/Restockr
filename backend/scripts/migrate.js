import "dotenv/config";
import { connectToDatabase, getDb } from "../db.js";
import { COLLECTIONS } from "../config.js";
import { ensureIndexes } from "../database/indexes.js";

try {
  await connectToDatabase();
  await ensureIndexes(getDb(), COLLECTIONS);
  console.log("Database indexes migrated");
  process.exit(0);
} catch (error) {
  console.error("Index migration failed", error);
  process.exit(1);
}

