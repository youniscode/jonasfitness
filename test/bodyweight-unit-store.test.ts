import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BODYWEIGHT_UNIT_STORAGE_KEY,
  DEFAULT_BODYWEIGHT_UNIT,
  parseBodyweightUnit,
  persistBodyweightUnit,
  readStoredBodyweightUnit,
} from "../app/lib/bodyweight-unit-store.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

// ---------- helpers: fake window/localStorage (no DOM in node) ----------

function fakeStorage(initial: Record<string, string> = {}, onSet?: (key: string) => void) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, value); onSet?.(key); },
  };
}

function withWindow<T>(storage: unknown, fn: () => T): T {
  const previous = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = { localStorage: storage } as Window & typeof globalThis;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = previous as Window & typeof globalThis;
  }
}

// ---------- default + key ----------

test("bodyweight unit defaults to kg when nothing is stored", () => {
  assert.equal(DEFAULT_BODYWEIGHT_UNIT, "kg");
  assert.equal(readStoredBodyweightUnit(), "kg", "SSR/node: no window => default kg");
  withWindow(fakeStorage({}), () => {
    assert.equal(readStoredBodyweightUnit(), "kg", "empty storage => default kg");
  });
});

test("storage key is stable and follows the jonas-progress-* naming convention", () => {
  assert.equal(BODYWEIGHT_UNIT_STORAGE_KEY, "jonas-progress-bodyweight-unit");
  assert.match(BODYWEIGHT_UNIT_STORAGE_KEY, /^jonas-progress-/);
});

test("parseBodyweightUnit coerces unknown/garbage/null to kg, keeps lb", () => {
  assert.equal(parseBodyweightUnit(null), "kg");
  assert.equal(parseBodyweightUnit(undefined as unknown as string), "kg");
  assert.equal(parseBodyweightUnit(""), "kg");
  assert.equal(parseBodyweightUnit("stone"), "kg");
  assert.equal(parseBodyweightUnit("KG"), "kg");
  assert.equal(parseBodyweightUnit("lb"), "lb");
  assert.equal(parseBodyweightUnit("kg"), "kg");
});

// ---------- restore / persistence semantics ----------

test("KG->LB then restore: persisted lb survives a remount read", () => {
  const storage = fakeStorage();
  withWindow(storage, () => {
    persistBodyweightUnit("lb");
    assert.equal(storage.getItem(BODYWEIGHT_UNIT_STORAGE_KEY), "lb", "written under the stable key");
    assert.equal(readStoredBodyweightUnit(), "lb", "restore-after-remount returns lb");
  });
});

test("LB->KG then restore: persisted kg survives a remount read", () => {
  const storage = fakeStorage({ [BODYWEIGHT_UNIT_STORAGE_KEY]: "lb" });
  withWindow(storage, () => {
    assert.equal(readStoredBodyweightUnit(), "lb", "pre-seeded lb is read");
    persistBodyweightUnit("kg");
    assert.equal(storage.getItem(BODYWEIGHT_UNIT_STORAGE_KEY), "kg");
    assert.equal(readStoredBodyweightUnit(), "kg");
  });
});

test("reload semantics: read after persist returns the latest choice", () => {
  const storage = fakeStorage();
  withWindow(storage, () => {
    persistBodyweightUnit("lb");
    assert.equal(readStoredBodyweightUnit(), "lb");
    persistBodyweightUnit("kg");
    assert.equal(readStoredBodyweightUnit(), "kg", "a later switch overrides the earlier one");
  });
});

test("only the unit preference is persisted, never measurement values", () => {
  const written: string[] = [];
  const storage = fakeStorage({}, (key) => written.push(key));
  withWindow(storage, () => {
    persistBodyweightUnit("lb");
    persistBodyweightUnit("kg");
    assert.deepEqual(written, [BODYWEIGHT_UNIT_STORAGE_KEY, BODYWEIGHT_UNIT_STORAGE_KEY], "the only key ever written is the unit preference");
  });
});

// ---------- degraded environments ----------

test("storage disabled: read falls back to kg and persist never throws", () => {
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  withWindow(broken, () => {
    assert.equal(readStoredBodyweightUnit(), "kg", "getItem throwing => kg default");
    assert.doesNotThrow(() => persistBodyweightUnit("lb"), "setItem throwing is swallowed");
  });
});

test("module is SSR-safe and holds no server/DB dependency", () => {
  const store = read("app", "lib", "bodyweight-unit-store.ts");
  assert.match(store, /typeof window === \"undefined\"/, "guards server renders");
  assert.doesNotMatch(store, /fetch\(/, "no network");
  assert.doesNotMatch(store, /drizzle|db\.|sql`/, "no DB access");
  assert.ok(!store.includes("\u2014"), "no U+2014 em dash");
});

// ---------- no DB/server unit preference was added ----------

test("bodyweight_entries schema stays canonical kg with no unit column", () => {
  const schema = read("db", "schema.ts");
  const tableStart = schema.indexOf("bodyweight_entries");
  assert.ok(tableStart !== -1, "bodyweight_entries table exists");
  const tableBlock = schema.slice(tableStart, tableStart + 1200);
  assert.match(tableBlock, /weightKg|weight_kg/, "canonical kg weight column");
  assert.doesNotMatch(tableBlock, /\bunit\b/, "no unit column in the table");
  assert.doesNotMatch(tableBlock, /weightLb|weight_lb/, "no lb column");
});

test("no server route or service persists a unit preference", () => {
  const routes = [
    read("app", "api", "progress", "bodyweight", "route.ts"),
    read("app", "api", "progress", "bodyweight", "[id]", "route.ts"),
  ];
  for (const src of routes) {
    assert.doesNotMatch(src, /bodyweight-unit-store|localStorage/, "routes never touch the local unit store");
    assert.doesNotMatch(src, /"unit"\s*:\s*\[\s*"kg"\s*,\s*"lb"\]|body\.unit\s*=\s*body\.unit/, "routes do not invent a unit preference");
  }
  const service = read("app", "lib", "progress-service.ts");
  assert.doesNotMatch(service, /bodyweight-unit-store/, "service has no local unit preference");
});

// ---------- client integration: panel seeds + persists ----------

test("BodyweightPanel seeds from the store and persists each switch", () => {
  const panel = read("app", "progress", "(product)", "bodyweight", "BodyweightPanel.tsx");
  assert.match(panel, /useState<BodyweightUnit>\(\(\) => readStoredBodyweightUnit\(\)\)/, "unit state seeded from the local store");
  assert.match(panel, /persistBodyweightUnit\(choice\)/, "each toggle persists the choice");
  assert.match(panel, /readStoredBodyweightUnit/, "panel reads the store");
});
