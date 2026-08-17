import { test } from "node:test";
import assert from "node:assert/strict";
import { positiveIntParam } from "../app/lib/query-params.ts";

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
