import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-neon",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/jonas_fitness",
  },
});
