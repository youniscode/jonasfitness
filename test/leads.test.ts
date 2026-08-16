import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicationValues,
  emailIsValid,
  isLeadStatus,
  isManualLeadStatus,
  leadStatuses,
  manualLeadStatuses,
  planConversion,
  reviewApplication,
} from "../app/lib/leads.ts";
import { safeSource, sourceFromReferrer, sourceFromUtm } from "../app/lib/attribution.ts";

test("lead status vocabulary is canonical and contains client, not converted", () => {
  assert.deepEqual([...leadStatuses], ["new", "contacted", "qualified", "client", "lost"]);
  assert.equal(isLeadStatus("client"), true);
  assert.equal(isLeadStatus("lost"), true);
  assert.equal(isLeadStatus("converted"), false);
  assert.equal(isLeadStatus("bogus"), false);
});

test("manual lead statuses exclude client (only conversion may set it)", () => {
  assert.deepEqual([...manualLeadStatuses], ["new", "contacted", "qualified", "lost"]);
  assert.equal(isManualLeadStatus("new"), true);
  assert.equal(isManualLeadStatus("lost"), true);
  assert.equal(isManualLeadStatus("client"), false);
  assert.equal(isManualLeadStatus("converted"), false);
});

test("reviewApplication accepts a valid application and normalizes it", () => {
  const result = reviewApplication({
    name: "  Maya H. ",
    email: "  Maya@Example.COM ",
    phone: " 06 12 34 56 78 ",
    country: " France ",
    consent: true,
    startedAt: Date.now() - 5000,
    attribution: { source: "Instagram", medium: "social", campaign: "summer" },
  });
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.values.name, "Maya H.");
    assert.equal(result.values.email, "maya@example.com");
    assert.equal(result.values.attribution.source, "Instagram");
    assert.equal(result.values.attribution.campaign, "summer");
  }
});

test("reviewApplication rejects a missing consent", () => {
  const result = reviewApplication({ name: "Maya", email: "maya@example.com", country: "France", startedAt: Date.now() - 5000 });
  assert.equal(result.accepted, false);
  if (!result.accepted && !("neutral" in result)) assert.equal(result.status, 400);
});

test("reviewApplication rejects an invalid email", () => {
  const result = reviewApplication({ name: "Maya", email: "not-an-email", country: "France", consent: true, startedAt: Date.now() - 5000 });
  assert.equal(result.accepted, false);
  if (!result.accepted && !("neutral" in result)) assert.equal(result.status, 400);
});

test("reviewApplication returns a neutral success for the honeypot field", () => {
  const result = reviewApplication({ name: "Maya", email: "maya@example.com", country: "France", consent: true, startedAt: Date.now() - 5000, website: "spam.com" });
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal("neutral" in result, true);
});

test("reviewApplication rejects a too-fast submission", () => {
  const now = Date.now();
  const result = reviewApplication({ name: "Maya", email: "maya@example.com", country: "France", consent: true, startedAt: now - 500 }, now);
  assert.equal(result.accepted, false);
  if (!result.accepted && !("neutral" in result)) assert.equal(result.status, 400);
});

test("applicationValues truncates excessive lengths and clamps ranges", () => {
  const values = applicationValues({
    name: "x".repeat(500),
    email: "maya@example.com",
    message: "m".repeat(5000),
    trainingDays: 99,
    coachingFormat: "Bogus",
    contactPreference: "Carrier pigeon",
    preferredLanguage: "xx",
    goal: "",
  });
  assert.equal(values.name.length, 100);
  assert.equal(values.message.length, 1200);
  assert.equal(values.trainingDays, 7);
  assert.equal(values.coachingFormat, "Online");
  assert.equal(values.contactPreference, "WhatsApp");
  assert.equal(values.preferredLanguage, "fr");
  assert.equal(values.goal, "General fitness");
});

test("malformed attribution source is normalized to Other", () => {
  assert.equal(safeSource("Totally fake source"), "Other");
  assert.equal(safeSource("Instagram"), "Instagram");
  assert.equal(safeSource(12345), "Other");
});

test("attribution sources map from UTM and referrer", () => {
  assert.equal(sourceFromUtm("instagram"), "Instagram");
  assert.equal(sourceFromUtm("fb"), "Facebook");
  assert.equal(sourceFromUtm("google"), "Google Search");
  assert.equal(sourceFromUtm("tiktok"), "TikTok");
  assert.equal(sourceFromUtm("unknown-thing"), "Other");
  assert.equal(sourceFromReferrer("https://www.instagram.com/p/xyz"), "Instagram");
  assert.equal(sourceFromReferrer("https://l.instagram.com"), "Instagram");
  assert.equal(sourceFromReferrer("https://www.tiktok.com/@user"), "TikTok");
  assert.equal(sourceFromReferrer("https://example.org/blog"), "Referral");
  assert.equal(sourceFromReferrer(""), "Direct");
});

test("emailIsValid rejects malformed and over-long emails", () => {
  assert.equal(emailIsValid("maya@example.com"), true);
  assert.equal(emailIsValid("not-an-email"), false);
  assert.equal(emailIsValid(""), false);
  assert.equal(emailIsValid(`${"a".repeat(200)}@example.com`), false);
});

test("planConversion decides create, link and already", () => {
  assert.deepEqual(planConversion({ convertedClientId: null, email: "maya@example.com" }, null), { kind: "create", email: "maya@example.com" });
  assert.deepEqual(planConversion({ convertedClientId: null, email: "maya@example.com" }, { id: 7 }), { kind: "link", clientId: 7 });
  assert.deepEqual(planConversion({ convertedClientId: 9, email: "maya@example.com" }, null), { kind: "already", clientId: 9 });
});
