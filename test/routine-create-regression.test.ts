import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app", "progress", "(product)", "routines", "RoutinesView.tsx"), "utf8");

// The create handler is the only place the bug can hide: a reference to
// event.currentTarget after an await throws in React
// ("Cannot read properties of null (reading 'reset')"), persisting the
// routine server-side while leaving the buyer on a broken screen.
const createStart = src.indexOf("async function create(");
assert.ok(createStart >= 0, "create handler found");
const createEnd = src.indexOf("return (", createStart);
assert.ok(createEnd > createStart, "create handler body end found");
const createFn = src.slice(createStart, createEnd);
const awaitIdx = createFn.indexOf("await json");
assert.ok(awaitIdx > 0, "create handler awaits the routine POST");

test("routine create captures a stable form reference before the await", () => {
  const before = createFn.slice(0, awaitIdx);
  assert.match(before, /const formElement = event\.currentTarget/, "form element captured before the async boundary");
  assert.match(before, /new FormData\(formElement\)/, "FormData built from the stable reference");
});

test("routine create never reads event.currentTarget after the async boundary", () => {
  const after = createFn.slice(awaitIdx);
  assert.doesNotMatch(after, /event\.currentTarget/, "no event.currentTarget after the await (the null.reset() bug)");
  assert.match(after, /formElement\.reset\(\)/, "form reset goes through the stable reference");
});

test("successful routine POST clears the error and navigates to the new routine detail page", () => {
  assert.match(createFn, /formElement\.reset\(\);\s*setError\(""\)/, "error state cleared after success");
  assert.match(createFn, /window\.location\.href = `\/progress\/routines\/\$\{data\.routine\.id\}`/, "browser navigates to /progress/routines/{newId}");
});

test("failed routine POST still shows the error and restoring the creating state", () => {
  assert.match(createFn, /catch \(issue\) \{\s*setError\(issue instanceof Error \? issue\.message : t\.error\);?\s*\}/, "failure surfaces the error message");
  assert.match(createFn, /finally \{ setCreating\(false\); \}/, "creating state restored in all outcomes");
});

test("the routine creation flow issues exactly one POST (no duplicate creation)", () => {
  const posts = src.match(/\/api\/progress\/routines"?, \{\s*method: "POST"/g) || [];
  assert.equal(posts.length, 1, "exactly one POST to the routines API in the component");
  const navigation = src.match(/window\.location\.href = `\/progress\/routines\/\$\{data\.routine\.id\}`/g) || [];
  assert.equal(navigation.length, 1, "single navigation after creation");
});
