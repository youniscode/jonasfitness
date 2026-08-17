import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCoachAuthDecision,
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

// ---------- evaluateCoachAuthDecision (atomic result) ----------

const allowed: Parameters<typeof evaluateCoachAuthDecision>[0] = {
  // Synthetic fixture id — proves the result carries the exact session id.
  userId: "user_2abcdefghijklmnopqrstuvwx",
  userLookupFailed: false,
  primaryEmail: "jonas@example.com",
  emailVerified: true,
  allowlistRaw: "jonas@example.com",
};

function result(input: Parameters<typeof evaluateCoachAuthDecision>[0]) {
  return evaluateCoachAuthDecision(input);
}

test("authenticated + verified + allowed email is allowed with the exact Clerk userId", () => {
  const r = result(allowed);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "allowed");
  if (r.allowed) assert.equal(r.coachId, "user_2abcdefghijklmnopqrstuvwx");
});

test("invariant: allowed always carries a non-null coachId", () => {
  const r = result(allowed);
  assert.equal(r.allowed, true);
  assert.ok(r.coachId, "allowed result must carry the coachId");
  assert.equal(r.reason, "allowed");
});

test("invariant: 'allowed' never coexists with a null coachId", () => {
  const withNullId = result({ ...allowed, userId: null });
  assert.equal(withNullId.allowed, false);
  assert.equal(withNullId.coachId, null);
  assert.notEqual(withNullId.reason, "allowed");
});

test("invariant: every denial reports coachId null and a truthful reason — 'denied: allowed' is impossible", () => {
  const denials = [
    { ...allowed, userId: null },
    { ...allowed, userLookupFailed: true },
    { ...allowed, primaryEmail: null },
    { ...allowed, primaryEmail: undefined },
    { ...allowed, emailVerified: false },
    { ...allowed, primaryEmail: "someone-else@example.com" },
  ];
  for (const input of denials) {
    const r = result(input);
    assert.equal(r.allowed, false, `expected denial for ${JSON.stringify(input)}`);
    assert.equal(r.coachId, null, "denied result must have coachId null");
    assert.notEqual(r.reason, "allowed", "a denial must never report reason 'allowed'");
    assert.ok(r.reason, "a denial must carry a reason");
  }
});

test("no session → denied with null coachId", () => {
  const r = result({ ...allowed, userId: null });
  assert.equal(r.allowed, false);
  assert.equal(r.coachId, null);
  assert.equal(r.reason, "no_session");
});

test("user lookup failure → denied with null coachId", () => {
  const r = result({ ...allowed, userLookupFailed: true });
  assert.equal(r.allowed, false);
  assert.equal(r.coachId, null);
  assert.equal(r.reason, "user_lookup_failed");
});

test("missing primary email → denied with null coachId", () => {
  assert.equal(result({ ...allowed, primaryEmail: null }).reason, "no_primary_email");
  assert.equal(result({ ...allowed, primaryEmail: undefined }).reason, "no_primary_email");
  assert.equal(result({ ...allowed, primaryEmail: null }).coachId, null);
});

test("unverified email → denied with null coachId even when allowlisted", () => {
  const r = result({ ...allowed, emailVerified: false });
  assert.equal(r.allowed, false);
  assert.equal(r.coachId, null);
  assert.equal(r.reason, "email_unverified");
});

test("verified email not in the allowlist → denied with null coachId", () => {
  const r = result({ ...allowed, primaryEmail: "someone-else@example.com" });
  assert.equal(r.allowed, false);
  assert.equal(r.coachId, null);
  assert.equal(r.reason, "email_not_allowed");
});

test("case and whitespace differences still allow with the exact Clerk userId", () => {
  const spaced = result({ ...allowed, primaryEmail: "  JONAS@Example.COM  " });
  assert.equal(spaced.allowed, true);
  if (spaced.allowed) assert.equal(spaced.coachId, allowed.userId);
  const quoted = result({ ...allowed, allowlistRaw: '  "jonas@example.com"  ' });
  assert.equal(quoted.allowed, true);
});
