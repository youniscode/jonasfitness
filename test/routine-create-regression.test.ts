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

test("failed routine POST shows a message (localized fallback) and restores the creating state", () => {
  assert.match(createFn, /catch \(issue\) \{\s*setError\(messageOf\(issue\) \|\| t\.error\);?\s*\}/, "failure surfaces the error message, localized when the server gave none");
  assert.match(createFn, /finally \{ setCreating\(false\); \}/, "creating state restored in all outcomes");
});

test("the raw literal \"error\" fallback from a non-JSON 500 never reaches the user", () => {
  const helper = src.slice(src.indexOf("function messageOf("), src.indexOf("export default function RoutinesView"));
  assert.match(helper, /issue instanceof Error && issue\.message && issue\.message !== "error" \? issue\.message : ""/, "a non-JSON server failure resolves to the localized generic instead of the literal 'error'");
  assert.doesNotMatch(createFn, /setError\("error"\)/, "the literal token is never rendered directly");
});

test("the routine creation flow issues exactly one POST (no duplicate creation)", () => {
  const posts = src.match(/\/api\/progress\/routines"?, \{\s*method: "POST"/g) || [];
  assert.equal(posts.length, 1, "exactly one POST to the routines API in the component");
  const navigation = src.match(/window\.location\.href = `\/progress\/routines\/\$\{data\.routine\.id\}`/g) || [];
  assert.equal(navigation.length, 1, "single navigation after creation");
});
