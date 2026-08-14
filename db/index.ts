import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type JonasGlobal = typeof globalThis & {
  __JONAS_DB?: D1Database;
  __JONAS_SCHEMA_READY?: Promise<void>;
  __JONAS_SCHEMA_VERSION?: number;
};

const SCHEMA_VERSION = 2;

function getBinding() {
  const binding = (globalThis as JonasGlobal).__JONAS_DB;
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return binding;
}

export async function ensureDatabaseSchema() {
  const appGlobal = globalThis as JonasGlobal;
  if (!appGlobal.__JONAS_SCHEMA_READY || appGlobal.__JONAS_SCHEMA_VERSION !== SCHEMA_VERSION) {
    const binding = getBinding();
    appGlobal.__JONAS_SCHEMA_READY = binding.batch([
      binding.prepare(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_email TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT 'Build muscle',
        status TEXT NOT NULL DEFAULT 'active',
        sessions_per_week INTEGER NOT NULL DEFAULT 4,
        current_weight REAL,
        adherence INTEGER NOT NULL DEFAULT 0,
        next_check_in TEXT,
        created_at TEXT NOT NULL
      )`),
      binding.prepare(`CREATE TABLE IF NOT EXISTS check_ins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        owner_email TEXT NOT NULL,
        weight REAL,
        energy INTEGER NOT NULL,
        sleep INTEGER NOT NULL,
        stress INTEGER NOT NULL,
        adherence INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        ai_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`),
      binding.prepare(`CREATE TABLE IF NOT EXISTS programmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        sessions_per_week INTEGER NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL
      )`),
      binding.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        owner_email TEXT NOT NULL,
        start_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        status TEXT NOT NULL DEFAULT 'scheduled',
        pulse_token TEXT NOT NULL UNIQUE,
        readiness_level TEXT NOT NULL DEFAULT 'pending',
        readiness_score INTEGER,
        energy INTEGER,
        sleep INTEGER,
        soreness INTEGER,
        stress INTEGER,
        pain INTEGER NOT NULL DEFAULT 0,
        pain_area TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        ai_summary TEXT NOT NULL DEFAULT '',
        coach_action TEXT NOT NULL DEFAULT '',
        responded_at TEXT,
        created_at TEXT NOT NULL
      )`),
      binding.prepare("CREATE INDEX IF NOT EXISTS clients_owner_email_idx ON clients (owner_email)"),
      binding.prepare("CREATE INDEX IF NOT EXISTS check_ins_client_owner_idx ON check_ins (client_id, owner_email)"),
      binding.prepare("CREATE INDEX IF NOT EXISTS programmes_client_owner_idx ON programmes (client_id, owner_email)"),
      binding.prepare("CREATE INDEX IF NOT EXISTS sessions_owner_start_idx ON sessions (owner_email, start_at)"),
      binding.prepare("CREATE INDEX IF NOT EXISTS sessions_client_idx ON sessions (client_id)"),
    ]).then(() => { appGlobal.__JONAS_SCHEMA_VERSION = SCHEMA_VERSION; }).catch((error) => {
      appGlobal.__JONAS_SCHEMA_READY = undefined;
      appGlobal.__JONAS_SCHEMA_VERSION = undefined;
      throw error;
    });
  }
  await appGlobal.__JONAS_SCHEMA_READY;
}

export function getDb() {
  return drizzle(getBinding(), { schema });
}
