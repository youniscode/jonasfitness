# Pre-rebaseline migration history (historical only)

These files are the Drizzle migration history as it existed **before** the
2026-08-16 migration rebaseline. They are kept for reference only.

## ⚠️ Do not apply these to production

- These files are **historical only** and must **never** be applied to any database.
- They are stale: `0000_easy_vargas.sql` only captures 4 tables and does not
  reflect the full current schema.
- Applying them (or re-importing them into an active migration directory) would
  produce incorrect or incomplete schema state.

## Context

- Production was originally managed primarily with `drizzle-kit push` (`db:push`),
  so the migration history drifted out of sync with the live schema.
- On **2026-08-16**, the migration history was **rebaselined**: a new full-schema
  baseline was generated directly from `db/schema.ts` and verified to match
  production exactly.

## Current active baseline

The active migration history now lives in:

- `drizzle-neon/0000_clumsy_ozymandias.sql`
- `drizzle-neon/meta/0000_snapshot.json`
- `drizzle-neon/meta/_journal.json`

## Contents of this archive

| File | Description |
|------|-------------|
| `0000_easy_vargas.sql` | Old 4-table baseline migration (superseded) |
| `meta/0000_snapshot.json` | Old snapshot matching the 4-table baseline |
| `meta/_journal.json` | Old journal entry for the pre-rebaseline history |
