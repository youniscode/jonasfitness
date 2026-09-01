import { test } from "node:test";
import assert from "node:assert/strict";

import {
  balancedTopLevelObjects,
  jsonCandidateSet,
  jsonExtractionCandidates,
  jsonParseDiagnostics,
  parseGatewayJsonText,
} from "../app/lib/local-ai.ts";

// ---------- Balanced-brace scanner ----------

test("balancedTopLevelObjects respects strings, escapes and nesting", () => {
  assert.deepEqual(balancedTopLevelObjects('{"a":1}'), { objects: ['{"a":1}'], unbalanced: false });
  // Braces inside strings must not count as nested objects.
  assert.deepEqual(balancedTopLevelObjects('{"a":"{not json}","b":2}'), { objects: ['{"a":"{not json}","b":2}'], unbalanced: false });
  // Escaped quotes inside strings are respected.
  assert.deepEqual(balancedTopLevelObjects('{"a":"he said \\"hi\\""}'), { objects: ['{"a":"he said \\"hi\\""}'], unbalanced: false });
  // Nested objects/arrays count correctly.
  assert.deepEqual(balancedTopLevelObjects('{"sessions":[{"name":"A"}]}'), { objects: ['{"sessions":[{"name":"A"}]}'], unbalanced: false });
});

test("balancedTopLevelObjects flags cut-off output as unbalanced", () => {
  assert.equal(balancedTopLevelObjects('{"a":1').unbalanced, true);
  assert.equal(balancedTopLevelObjects('{"title":"3-Day').unbalanced, true);
  // Complete object followed by an unclosed one is still unbalanced.
  assert.equal(balancedTopLevelObjects('{"a":1} {"b":2').unbalanced, true);
  assert.equal(balancedTopLevelObjects('{"a":1}').unbalanced, false);
});

// ---------- Accepted shapes ----------

test("direct JSON object parses", () => {
  const result = parseGatewayJsonText<{ a: number }>('{"a":1}');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { a: 1 });
});

test("fenced JSON parses (formatting noise only)", () => {
  const result = parseGatewayJsonText<{ a: number }>("```json\n{\"a\": 1}\n```");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { a: 1 });
});

test("bounded prefix + suffix chatter with one object parses", () => {
  const result = parseGatewayJsonText<{ a: number }>("Sure! Here is the adjusted programme:\n{\"a\":1}\nHope this helps.");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { a: 1 });
});

test("JSON string wrapping an object is unwrapped and parsed", () => {
  const result = parseGatewayJsonText<{ a: number }>('"{\\"a\\":1}"');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { a: 1 });
});

test("single unambiguous embedded object is extracted", () => {
  const result = parseGatewayJsonText<{ a: number }>('{"a":1}');
  assert.equal(result.ok, true);
});

test("braces and escaped quotes inside strings never break parsing", () => {
  const content = '{"title":"A \\"quoted\\" plan","note":"{not json}"}';
  const result = parseGatewayJsonText<{ title: string; note: string }>(content);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.title, 'A "quoted" plan');
    assert.equal(result.value.note, "{not json}");
  }
});

// ---------- Rejected shapes ----------

test("multiple competing JSON objects are rejected, never guessed", () => {
  assert.deepEqual(parseGatewayJsonText('{"a":1} then {"b":2}'), { ok: false, reason: "malformed_json" });
  assert.deepEqual(parseGatewayJsonText('{"a":1}{"b":2}'), { ok: false, reason: "malformed_json" });
});

test("unbalanced / cut-off JSON object is classified as truncated", () => {
  assert.deepEqual(parseGatewayJsonText('{"a":'), { ok: false, reason: "truncated" });
  assert.deepEqual(parseGatewayJsonText('{"title":"3-Day Full Body'), { ok: false, reason: "truncated" });
  // Plain prose starting with a brace but no string content stays malformed.
  assert.deepEqual(parseGatewayJsonText("{not json"), { ok: false, reason: "malformed_json" });
});

test("finish_reason length → truncated even when content is present", () => {
  assert.deepEqual(
    parseGatewayJsonText("here is a partial response", { finishReason: "length" }),
    { ok: false, reason: "truncated" },
  );
});

test("excessive chatter around an object is rejected", () => {
  const padding = "explanation ".repeat(40);
  const text = `${padding}{"a":1}${padding}`;
  assert.deepEqual(parseGatewayJsonText(text), { ok: false, reason: "malformed_json" });
});

test("invalid JSON stays malformed_json", () => {
  assert.deepEqual(parseGatewayJsonText("Sure, here is a plan:"), { ok: false, reason: "malformed_json" });
  assert.deepEqual(parseGatewayJsonText("{a:1}"), { ok: false, reason: "malformed_json" });
});

test("empty output → empty_response", () => {
  assert.deepEqual(parseGatewayJsonText(""), { ok: false, reason: "empty_response" });
  assert.deepEqual(parseGatewayJsonText(undefined), { ok: false, reason: "empty_response" });
});

// ---------- Candidate set / diagnostics ----------

test("jsonExtractionCandidates still exposes pure, fenced and braced candidates", () => {
  assert.deepEqual(jsonExtractionCandidates('{"a":1}'), ['{"a":1}']);
  const fenced = jsonExtractionCandidates("```json\n{\"a\": 1}\n```");
  assert.ok(fenced.includes('{"a": 1}'), "fenced inner content is a candidate");
  const prosey = jsonExtractionCandidates("Here:\n{\"a\":1}\nDone");
  assert.ok(prosey.includes('{"a":1}'), "braced substring is a candidate");
  assert.deepEqual(jsonExtractionCandidates("no json here"), ["no json here"]);
});

test("jsonCandidateSet never emits an embedded candidate for multiple objects", () => {
  const set = jsonCandidateSet('{"a":1} then {"b":2}');
  assert.equal(set.failure, "multiple_ambiguous");
  assert.equal(set.candidates.length, 1); // only the raw text - no per-object guesses
});

test("jsonParseDiagnostics reports stage and counts only - never content", () => {
  const ok = jsonParseDiagnostics('{"a":1}');
  assert.equal(ok.result, "ok");
  assert.equal(ok.stage, "parsed_direct");
  assert.equal(ok.candidateCount, 1);
  assert.equal(ok.contentChars, 7);

  const fenced = jsonParseDiagnostics("```json\n{\"a\":1}\n```");
  assert.equal(fenced.stage, "parsed_fenced");

  const truncated = jsonParseDiagnostics('{"a":');
  assert.equal(truncated.stage, "truncated");
  assert.equal(truncated.result, "truncated");

  const ambiguous = jsonParseDiagnostics('{"a":1} {"b":2}');
  assert.equal(ambiguous.stage, "multiple_ambiguous_candidates");
  assert.equal(ambiguous.result, "malformed");
});

test("parse diagnostics log payload cannot contain response content", () => {
  const payload = jsonParseDiagnostics('{"title":"SECRET CLIENT PLAN","sessions":[]}');
  assert.ok(!JSON.stringify(payload).includes("SECRET"));
});
