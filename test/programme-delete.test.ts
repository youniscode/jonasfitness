import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProgrammeId } from "../app/lib/programme-delete.ts";

test("parseProgrammeId accepts positive integer ids", () => {
  assert.equal(parseProgrammeId("1"), 1);
  assert.equal(parseProgrammeId("42"), 42);
  assert.equal(parseProgrammeId(" 7 "), 7);
});

test("parseProgrammeId rejects malformed ids", () => {
  assert.equal(parseProgrammeId("abc"), null);
  assert.equal(parseProgrammeId("1.5"), null);
  assert.equal(parseProgrammeId("0"), null);
  assert.equal(parseProgrammeId("-3"), null);
  assert.equal(parseProgrammeId(""), null);
});

// Deleting a programme must never cascade into completed workout history.
// The workout_sessions → programmes foreign key is ON DELETE SET NULL, so only
// the link is cleared and the workout snapshot (exercises JSON) survives.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function migrationSql() {
  return ["0000_clumsy_ozymandias.sql", "0001_first_venom.sql", "0002_rapid_adam_destine.sql"]
    .map((name) => readFileSync(join(projectRoot, "drizzle-neon", name), "utf8"))
    .join("\n");
}

test("the workout_sessions → programmes FK is SET NULL, not CASCADE", () => {
  const sql = migrationSql();
  const fkLine = sql.split("\n").find((line) => line.includes("workout_sessions_programme_id_programmes_id_fk"));
  assert.ok(fkLine, "expected the workout_sessions → programmes FK to be defined");
  assert.match(fkLine, /ON DELETE set null/i, "programme FK must be SET NULL so workout history survives");
  assert.doesNotMatch(fkLine, /ON DELETE cascade/i);
});

test("workout_sessions.programme_id is nullable so SET NULL can apply", () => {
  const sql = migrationSql();
  const columnLine = sql.split("\n").find((line) => line.includes('"programme_id" integer'));
  assert.ok(columnLine, "expected the workout_sessions.programme_id column to be defined");
  assert.doesNotMatch(columnLine, /not null/i, "programme_id must be nullable for SET NULL to apply");
});
