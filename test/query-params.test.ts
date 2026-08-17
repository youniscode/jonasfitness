import { test } from "node:test";
import assert from "node:assert/strict";
import { isPositiveInt, positiveIntParam } from "../app/lib/query-params.ts";

function params(query: string): URLSearchParams {
  return new URL(`http://localhost/api/client-onboarding?${query}`).searchParams;
}

test("clientId=1 parses to the numeric client id 1", () => {
  assert.equal(positiveIntParam(params("clientId=1"), "clientId"), 1);
});

test("missing parameter yields undefined", () => {
  assert.equal(positiveIntParam(params(""), "clientId"), undefined);
});

test("non-numeric values are rejected", () => {
  assert.equal(positiveIntParam(params("clientId=abc"), "clientId"), undefined);
  assert.equal(positiveIntParam(params("clientId="), "clientId"), undefined);
});

test("non-positive integers are rejected", () => {
  assert.equal(positiveIntParam(params("clientId=0"), "clientId"), undefined);
  assert.equal(positiveIntParam(params("clientId=-1"), "clientId"), undefined);
});

test("non-integer numbers are rejected", () => {
  assert.equal(positiveIntParam(params("clientId=1.5"), "clientId"), undefined);
});

test("decimal notation and surrounding whitespace still parse to the integer", () => {
  assert.equal(positiveIntParam(params("clientId=01"), "clientId"), 1);
  assert.equal(positiveIntParam(params("clientId=%201%20"), "clientId"), 1);
});

test("parameters are read by name and do not leak across names", () => {
  assert.equal(positiveIntParam(params("preview=1"), "clientId"), undefined);
  assert.equal(positiveIntParam(params("clientId=1&preview=2"), "preview"), 2);
});

// ---------- isPositiveInt (client-side fetch eligibility guard) ----------

test("a valid positive client id is fetch-eligible", () => {
  assert.equal(isPositiveInt(1), true);
});

test("undefined client id is never fetch-eligible", () => {
  assert.equal(isPositiveInt(undefined), false);
});

test("null client id is never fetch-eligible", () => {
  assert.equal(isPositiveInt(null), false);
});

test("zero is never fetch-eligible", () => {
  assert.equal(isPositiveInt(0), false);
});

test("negative ids are never fetch-eligible", () => {
  assert.equal(isPositiveInt(-1), false);
});

test("NaN is never fetch-eligible", () => {
  assert.equal(isPositiveInt(Number.NaN), false);
});

test("non-integer numbers are never fetch-eligible", () => {
  assert.equal(isPositiveInt(1.5), false);
});

test("switching clients 1 -> 2 keeps both ids fetch-eligible", () => {
  assert.equal(isPositiveInt(1), true);
  assert.equal(isPositiveInt(2), true);
});
