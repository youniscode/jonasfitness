import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// The Neon WebSocket driver (drizzle-orm/neon-serverless + Pool) supports
// db.transaction(), unlike the HTTP driver (drizzle-orm/neon-http + neon)
// whose session throws "No transactions support in neon-http driver". The pool
// is a module-level singleton so a warm serverless instance reuses its
// connection rather than creating a pool on every request.
let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. Connect Neon to this Vercel project, then pull the environment variables.");
  }
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export function getDb() {
  database ??= createDatabase();
  return database;
}
