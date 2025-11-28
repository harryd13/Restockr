import dotenv from "dotenv";
import { connectToDatabase, getDb } from "./db.js";
import { branches, users, categories, items } from "./data.js";

dotenv.config();

async function seed() {
  await connectToDatabase();
  const db = getDb();

  const collections = [
    { name: "branches", data: branches },
    { name: "users", data: users },
    { name: "categories", data: categories },
    { name: "items", data: items }
  ];

  for (const { name, data } of collections) {
    const col = db.collection(name);
    if (!data?.length) continue;
    const ops = data.map((doc) => ({
      updateOne: {
        filter: { id: doc.id },
        update: { $set: doc },
        upsert: true
      }
    }));
    await col.bulkWrite(ops, { ordered: false });
    console.log(`Seeded ${name} (${data.length} records)`);
  }

  console.log("Seeding complete");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed", err);
    process.exit(1);
  });
