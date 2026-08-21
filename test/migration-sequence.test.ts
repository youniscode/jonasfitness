import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The migration workflow is drizzle-kit generate (npm run db:generate): every
// journal entry has a matching numbered SQL file and snapshot, and the last
// entry is the highest index with no gaps. These tests guard the sequence so a
// hand-written migration can never collide with the established workflow.
const DRIZZLE = join(process.cwd(), "drizzle-neon");

test("journal entries are monotonically increasing with matching SQL files", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const sqlFiles = new Set(readdirSync(DRIZZLE).filter((file) => file.endsWith(".sql")));
  let previous = -1;
  for (const entry of journal.entries) {
    assert.equal(entry.idx, previous + 1, `journal idx gap or duplicate at ${entry.tag}`);
    assert.ok(sqlFiles.has(`${entry.tag}.sql`), `missing SQL file for journal entry ${entry.tag}`);
    previous = entry.idx;
  }
  assert.ok(previous >= 0, "journal must not be empty");
  // No SQL file may exist outside the journal (an unregistered migration would
  // never be applied and would collide with the sequence).
  const registered = new Set(journal.entries.map((entry) => `${entry.tag}.sql`));
  for (const file of sqlFiles) {
    assert.ok(registered.has(file), `unregistered migration file ${file}`);
  }
});

test("the onboarding profile migration (0007) is additive-only and adds only the profile column", () => {
  const sql = readFileSync(join(DRIZZLE, "0007_amused_pride.sql"), "utf8");
  // The onboarding V2 migration must ONLY add the client_intakes.profile column.
  assert.match(sql, /ALTER TABLE "client_intakes" ADD COLUMN "profile" text DEFAULT '\{\}' NOT NULL/);
  assert.doesNotMatch(sql, /\bDROP\b/i, "DROP is not allowed");
  assert.doesNotMatch(sql, /\bDELETE\b/i, "DELETE is not allowed");
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i, "TRUNCATE is not allowed");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
});

test("the latest migration (0011) is additive-only and creates only the nutrition_targets table", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const latest = journal.entries[journal.entries.length - 1];
  assert.equal(latest.tag, "0011_nutrition-targets");
  const sql = readFileSync(join(DRIZZLE, `${latest.tag}.sql`), "utf8");
  // The nutrition-targets migration must create ONLY the nutrition_targets
  // table — exactly one CREATE TABLE, nothing else.
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1, "exactly one table creation");
  assert.match(sql, /CREATE TABLE "nutrition_targets"/);
  // No destructive or unrelated operations anywhere in the latest migration.
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, "no destructive top-level operations");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
  // The FK constraint is attached with ALTER TABLE on the NEW table (standard
  // drizzle output); any ALTER targeting a pre-existing table is forbidden.
  assert.doesNotMatch(sql, /ALTER TABLE (?!"nutrition_targets")/i, "no ALTER of existing tables");
  // Unlike the append-only measurement ledger, this table needs exactly one
  // active (approved) row per owner+client — enforced by a PARTIAL unique index
  // (superseded history rows are unaffected).
  assert.match(sql, /CREATE UNIQUE INDEX "nutrition_targets_owner_client_active_unique"/);
  assert.match(sql, /WHERE "nutrition_targets"\."status" = 'approved'/);
});

test("every applied migration is additive-only (no destructive operations anywhere)", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries) {
    const sql = readFileSync(join(DRIZZLE, `${entry.tag}.sql`), "utf8");
    // Project convention: migrations create tables/columns/indexes and add
    // columns — never drop, truncate or delete. (FK references use ON DELETE
    // clauses in CREATE TABLE, which is fine; the banned words are top-level ops.)
    assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, `destructive op in ${entry.tag}`);
  }
});
