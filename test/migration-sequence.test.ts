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

test("the nutrition-targets migration (0011) is additive-only and creates only the nutrition_targets table", () => {
  const sql = readFileSync(join(DRIZZLE, "0011_nutrition-targets.sql"), "utf8");
  // The nutrition-targets migration must create ONLY the nutrition_targets
  // table - exactly one CREATE TABLE, nothing else.
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1, "exactly one table creation");
  assert.match(sql, /CREATE TABLE "nutrition_targets"/);
  // No destructive or unrelated operations anywhere in the latest migration.
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, "no destructive top-level operations");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
  // The FK constraint is attached with ALTER TABLE on the NEW table (standard
  // drizzle output); any ALTER targeting a pre-existing table is forbidden.
  assert.doesNotMatch(sql, /ALTER TABLE (?!"nutrition_targets")/i, "no ALTER of existing tables");
  // Unlike the append-only measurement ledger, this table needs exactly one
  // active (approved) row per owner+client - enforced by a PARTIAL unique index
  // (superseded history rows are unaffected).
  assert.match(sql, /CREATE UNIQUE INDEX "nutrition_targets_owner_client_active_unique"/);
  assert.match(sql, /WHERE "nutrition_targets"\."status" = 'approved'/);
});

test("the meal-plans migration (0012) is additive-only and creates only the three meal-plan tables", () => {
  // Looked up by its own index/tag (not "latest") so later additive migrations
  // (e.g. the self-service Progress migrations 0013+) do not invalidate it.
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const mealPlans = journal.entries.find((entry) => entry.idx === 12);
  assert.ok(mealPlans, "meal-plans migration is journal index 12");
  assert.equal(mealPlans.tag, "0012_magenta_wallflower");
  const sql = readFileSync(join(DRIZZLE, `${mealPlans.tag}.sql`), "utf8");
  // Exactly the three Phase 2B tables - nothing else is touched.
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 3, "exactly three table creations");
  assert.match(sql, /CREATE TABLE "meal_plans"/);
  assert.match(sql, /CREATE TABLE "meal_plan_versions"/);
  assert.match(sql, /CREATE TABLE "meal_plan_assignments"/);
  // No destructive or unrelated operations.
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, "no destructive top-level operations");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
  assert.doesNotMatch(sql, /ALTER TABLE (?!"meal_plans"|"meal_plan_versions"|"meal_plan_assignments")/i, "no ALTER of existing tables");
  // Version immutability + single-active-assignment guarantees.
  assert.match(sql, /CREATE UNIQUE INDEX "meal_plan_versions_plan_number_unique"/);
  assert.match(sql, /CREATE UNIQUE INDEX "meal_plan_assignments_client_active_unique"/);
  assert.match(sql, /WHERE "meal_plan_assignments"\."active" = true/);
  // Client deletion cascades through plans → versions → assignments.
  assert.match(sql, /ON DELETE cascade/);
});

test("every applied migration is additive-only (no destructive table/column/data operations)", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  for (const entry of journal.entries) {
    const sql = readFileSync(join(DRIZZLE, `${entry.tag}.sql`), "utf8");
    // Project convention: migrations create tables/columns/indexes and add
    // columns - never drop data-bearing objects, truncate or delete. The one
    // sanctioned exception is DROP INDEX: dropping a redundant uniqueness index
    // (migration 0015) preserves every row while fixing the re-grant invariant.
    assert.doesNotMatch(sql, /^\s*(DROP (TABLE|COLUMN|SCHEMA|VIEW|TRIGGER|FUNCTION|SEQUENCE)|DELETE FROM|TRUNCATE)\b/mi, `destructive op in ${entry.tag}`);
  }
});

test("the Progress training migration (0013) is additive-only and creates the three owner-scoped training tables", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  // Looked up by its own index/tag (not "latest") so the later additive
  // commerce migration (0014) does not invalidate this guard.
  const training = journal.entries.find((entry) => entry.idx === 13);
  assert.ok(training, "Progress training migration is journal index 13");
  assert.equal(training.tag, "0013_parched_madrox");
  const sql = readFileSync(join(DRIZZLE, `${training.tag}.sql`), "utf8");
  // Exactly the three self-service Progress tables.
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 3, "exactly three table creations");
  assert.match(sql, /CREATE TABLE "training_routines"/);
  assert.match(sql, /CREATE TABLE "training_routine_exercises"/);
  assert.match(sql, /CREATE TABLE "training_workout_sessions"/);
  // No destructive or unrelated operations.
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, "no destructive top-level operations");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
  // Ordering is enforced at the database level via the unique (routine, position).
  assert.match(sql, /CREATE UNIQUE INDEX "training_routine_exercises_routine_position_unique"/);
  // Client-less self-service tables must never leak across owners: owner_id is
  // indexed everywhere it is queried.
  assert.match(sql, /CREATE INDEX "training_routines_owner_updated_idx"/);
  assert.match(sql, /CREATE INDEX "training_workout_sessions_owner_status_idx"/);
  // Routine deletion must NOT destroy logged history (workout sessions survive).
  assert.ok(sql.includes("training_workout_sessions_routine_id_training_routines_id_fk"), "workout session FK to routine");
});

test("the Founding Access commerce migration (0014) is additive-only and creates the four commercial tables", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  // Looked up by its own index/tag (not "latest") so the later index-fix
  // migration (0015) does not invalidate this guard.
  const commerce = journal.entries.find((entry) => entry.idx === 14);
  assert.ok(commerce, "Founding Access commerce migration is journal index 14");
  const sql = readFileSync(join(DRIZZLE, `${commerce.tag}.sql`), "utf8");
  // Exactly the four Phase 2 commercial tables, nothing else.
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 4, "exactly four table creations");
  assert.match(sql, /CREATE TABLE "commerce_orders"/);
  assert.match(sql, /CREATE TABLE "product_entitlements"/);
  assert.match(sql, /CREATE TABLE "payment_webhook_events"/);
  assert.match(sql, /CREATE TABLE "validation_events"/);
  // No destructive or unrelated operations.
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|TRUNCATE)\b/mi, "no destructive top-level operations");
  assert.doesNotMatch(sql, /\bALTER COLUMN\b/i, "no destructive ALTER COLUMN");
  // Idempotency + ownership guarantees enforced at the database level.
  assert.match(sql, /CREATE UNIQUE INDEX "commerce_orders_provider_checkout_unique"/, "checkout id is the idempotency anchor");
  assert.match(sql, /CREATE UNIQUE INDEX "payment_webhook_events_provider_event_unique"/, "webhook event id is unique for replays");
  assert.match(sql, /CREATE UNIQUE INDEX "product_entitlements_owner_product_active_unique"/, "at most one active entitlement per owner+product");
  assert.match(sql, /WHERE "product_entitlements"\.\"status" = 'active'/, "partial unique on active entitlement");
  assert.match(sql, /CREATE UNIQUE INDEX "validation_events_owner_name_key_unique"/, "validation events are deduplicated by (owner, name, key)");
});

test("the entitlement index fix (0015) drops only the redundant broad unique so a revoked grant can be re-granted", () => {
  const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const fix = journal.entries.find((entry) => entry.idx === 15);
  assert.ok(fix, "entitlement index fix migration is journal index 15");
  const sql = readFileSync(join(DRIZZLE, `${fix.tag}.sql`), "utf8");
  // The ONLY thing this migration does is drop the broad (owner_id, product_key)
  // unique that would otherwise block a later re-grant after a revocation.
  assert.equal((sql.match(/DROP INDEX/g) ?? []).length, 1, "exactly one index drop");
  assert.match(sql, /DROP INDEX "product_entitlements_owner_product_unique"/, "drops the redundant broad unique on (owner, product)");
  // It must not alter the PARTIAL active-entitlement unique (the invariant that
  // guarantees at most one ACTIVE entitlement per owner+product).
  assert.doesNotMatch(sql, /product_entitlements_owner_product_active_unique/, "partial active unique untouched");
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|CREATE TABLE/, "no data or table/column changes");
});
