import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniqueViolation, normaliseClientEmail } from "../app/lib/client-email.ts";

test("normaliseClientEmail trims and lowercases", () => {
  assert.equal(normaliseClientEmail("  User@Example.COM "), "user@example.com");
});

test("emails differing only by case normalise to the same value", () => {
  assert.equal(normaliseClientEmail("Alex@Example.com"), normaliseClientEmail("alex@example.com"));
});

test("normaliseClientEmail returns an empty string for non-strings", () => {
  assert.equal(normaliseClientEmail(undefined), "");
  assert.equal(normaliseClientEmail(null), "");
  assert.equal(normaliseClientEmail(123), "");
});

test("isUniqueViolation detects the Postgres SQLSTATE 23505 code", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: 23505 }), true);
});

test("isUniqueViolation detects a duplicate-key message from other drivers", () => {
  assert.equal(
    isUniqueViolation({ message: 'duplicate key value violates unique constraint "clients_email_lower_unique"' }),
    true,
  );
});

test("isUniqueViolation ignores unrelated errors", () => {
  assert.equal(isUniqueViolation(new Error("connection refused")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation("23505"), false);
});
