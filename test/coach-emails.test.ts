import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coachAuthDecision,
  isAllowedCoachEmail,
  normalizeCoachEmail,
  parseCoachEmails,
} from "../app/lib/coach-emails.ts";

// ---------- parseCoachEmails ----------

test("single email parses to one normalised entry", () => {
  assert.deepEqual(parseCoachEmails("Jonas@Example.com"), ["jonas@example.com"]);
});

test("comma-separated emails parse to multiple entries", () => {
  assert.deepEqual(parseCoachEmails("jonas@example.com, backup@example.com"), [
    "jonas@example.com",
    "backup@example.com",
  ]);
});

test("surrounding whitespace is trimmed from the whole value and each entry", () => {
  assert.deepEqual(parseCoachEmails("  jonas@example.com ,  backup@example.com  "), [
    "jonas@example.com",
    "backup@example.com",
  ]);
});

test("literal double quotes from env formatting are stripped", () => {
  assert.deepEqual(parseCoachEmails('"jonas@example.com"'), ["jonas@example.com"]);
  assert.deepEqual(parseCoachEmails('"jonas@example.com", "backup@example.com"'), [
    "jonas@example.com",
    "backup@example.com",
  ]);
});

test("literal single quotes are stripped", () => {
  assert.deepEqual(parseCoachEmails("'jonas@example.com'"), ["jonas@example.com"]);
});

test("mixed quote styles are stripped", () => {
  assert.deepEqual(parseCoachEmails("'\"jonas@example.com\"'"), ["jonas@example.com"]);
});

test("apostrophes inside an address are preserved", () => {
  assert.deepEqual(parseCoachEmails("o'neil@example.com"), ["o'neil@example.com"]);
});

test("empty entries are rejected", () => {
  assert.deepEqual(parseCoachEmails("jonas@example.com,"), ["jonas@example.com"]);
  assert.deepEqual(parseCoachEmails("jonas@example.com,,backup@example.com"), [
    "jonas@example.com",
    "backup@example.com",
  ]);
  assert.deepEqual(parseCoachEmails('""'), []);
  assert.deepEqual(parseCoachEmails("   ,  "), []);
});

test("empty or missing environment value yields an empty allowlist", () => {
  assert.deepEqual(parseCoachEmails(""), []);
  assert.deepEqual(parseCoachEmails(undefined), []);
  assert.deepEqual(parseCoachEmails(null), []);
});

test("entries are normalised to lowercase", () => {
  assert.deepEqual(parseCoachEmails("JONAS@EXAMPLE.COM, Coach@Example.com"), [
    "jonas@example.com",
    "coach@example.com",
  ]);
});

// ---------- normalizeCoachEmail ----------

test("normalizeCoachEmail trims and lowercases", () => {
  assert.equal(normalizeCoachEmail("  Jonas@Example.com  "), "jonas@example.com");
});

// ---------- isAllowedCoachEmail ----------

test("verified primary email exactly in the allowlist is allowed", () => {
  assert.equal(isAllowedCoachEmail("jonas@example.com", "jonas@example.com"), true);
});

test("uppercase/lowercase email is equivalent to the allowlist entry", () => {
  assert.equal(isAllowedCoachEmail("JONAS@Example.COM", "jonas@example.com"), true);
  assert.equal(isAllowedCoachEmail("jonas@example.com", "JONAS@EXAMPLE.COM"), true);
});

test("whitespace around the allowlist value and the email is handled", () => {
  assert.equal(isAllowedCoachEmail("  jonas@example.com  ", "  jonas@example.com  "), true);
});

test("a quoted allowlist value still matches (env formatting artifact)", () => {
  assert.equal(isAllowedCoachEmail("jonas@example.com", '"jonas@example.com"'), true);
});

test("email not in the allowlist is rejected", () => {
  assert.equal(isAllowedCoachEmail("other@example.com", "jonas@example.com"), false);
  assert.equal(isAllowedCoachEmail("jonas@example.com", "backup@example.com"), false);
});

test("a prefix/suffix of an allowlist entry never matches", () => {
  assert.equal(isAllowedCoachEmail("jonas@example.com.evil.com", "jonas@example.com"), false);
  assert.equal(isAllowedCoachEmail("xjonas@example.com", "jonas@example.com"), false);
});

test("missing email or allowlist is rejected", () => {
  assert.equal(isAllowedCoachEmail(null, "jonas@example.com"), false);
  assert.equal(isAllowedCoachEmail(undefined, "jonas@example.com"), false);
  assert.equal(isAllowedCoachEmail("jonas@example.com", ""), false);
  assert.equal(isAllowedCoachEmail("jonas@example.com", undefined), false);
});

test("multiple allowlist entries are all honoured", () => {
  const raw = "jonas@example.com, backup@example.com";
  assert.equal(isAllowedCoachEmail("jonas@example.com", raw), true);
  assert.equal(isAllowedCoachEmail("backup@example.com", raw), true);
  assert.equal(isAllowedCoachEmail("third@example.com", raw), false);
});

// ---------- coachAuthDecision ----------

const allowed: Parameters<typeof coachAuthDecision>[0] = {
  hasSession: true,
  userLookupFailed: false,
  primaryEmail: "jonas@example.com",
  emailVerified: true,
  allowlistRaw: "jonas@example.com",
};

test("authenticated + verified + allowed email is allowed", () => {
  assert.equal(coachAuthDecision(allowed), "allowed");
});

test("no session is rejected", () => {
  assert.equal(coachAuthDecision({ ...allowed, hasSession: false }), "no_session");
});

test("user lookup failure is rejected", () => {
  assert.equal(coachAuthDecision({ ...allowed, userLookupFailed: true }), "user_lookup_failed");
});

test("missing primary email is rejected", () => {
  assert.equal(coachAuthDecision({ ...allowed, primaryEmail: null }), "no_primary_email");
  assert.equal(coachAuthDecision({ ...allowed, primaryEmail: undefined }), "no_primary_email");
});

test("unverified email is rejected even when allowlisted", () => {
  assert.equal(coachAuthDecision({ ...allowed, emailVerified: false }), "email_unverified");
});

test("verified email not in the allowlist is rejected", () => {
  assert.equal(
    coachAuthDecision({ ...allowed, primaryEmail: "someone-else@example.com" }),
    "email_not_allowed",
  );
});

test("case and whitespace differences still allow", () => {
  assert.equal(
    coachAuthDecision({ ...allowed, primaryEmail: "  JONAS@Example.COM  " }),
    "allowed",
  );
  assert.equal(coachAuthDecision({ ...allowed, allowlistRaw: '  "jonas@example.com"  ' }), "allowed");
});
