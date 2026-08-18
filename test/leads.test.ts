import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicationValues,
  deletableLeadStatuses,
  emailIsValid,
  isDeletableLeadStatus,
  isLeadStatus,
  isManualLeadStatus,
  leadStatuses,
  manualLeadStatuses,
  normaliseLeadEmail,
  planConversion,
  planLeadDeletion,
  planLeadResubmission,
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
  // The goal default is the canonical onboarding value ("General fitness" was
  // a legacy app label; canonical is "Improve fitness").
  assert.equal(values.goal, "Improve fitness");
});

test("applicationValues canonicalizes the primary goal and keeps it in lead.goal", () => {
  const values = applicationValues({ goal: "Build strength", consent: true });
  assert.equal(values.goal, "Get stronger");
  const canonical = applicationValues({ goal: "Build muscle" });
  assert.equal(canonical.goal, "Build muscle");
});

test("applicationValues accepts and canonicalizes secondary objectives", () => {
  const values = applicationValues({
    goal: "Build muscle",
    secondaryGoals: ["Get stronger", "Fat loss", "General fitness", "junk", "Get stronger"],
  });
  assert.deepEqual(values.secondaryGoals, ["Get stronger", "Lose body fat", "Improve fitness"]);
});

test("applicationValues drops secondaries that repeat the primary or are not arrays", () => {
  const values = applicationValues({ goal: "Build muscle", secondaryGoals: ["Build muscle", "Fat loss"] });
  assert.deepEqual(values.secondaryGoals, ["Lose body fat"]);
  assert.deepEqual(applicationValues({ goal: "Build muscle" }).secondaryGoals, []);
  assert.deepEqual(applicationValues({ goal: "Build muscle", secondaryGoals: "Build strength" }).secondaryGoals, []);
});

test("applicationSecondaryGoals caps at five entries", () => {
  const values = applicationValues({ goal: "Build muscle", secondaryGoals: ["Get stronger", "Improve fitness", "Return to training", "Improve general health", "Fat loss", "Other"] });
  assert.equal(values.secondaryGoals.length, 5);
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

test("deletable lead statuses are the active + lost set, excluding client", () => {
  assert.deepEqual([...deletableLeadStatuses], ["new", "contacted", "qualified", "lost"]);
  assert.equal(isDeletableLeadStatus("new"), true);
  assert.equal(isDeletableLeadStatus("qualified"), true);
  assert.equal(isDeletableLeadStatus("lost"), true);
  assert.equal(isDeletableLeadStatus("client"), false);
  assert.equal(isDeletableLeadStatus("converted"), false);
});

test("planLeadDeletion allows active and lost leads", () => {
  assert.deepEqual(planLeadDeletion({ status: "new", convertedClientId: null }), { allowed: true });
  assert.deepEqual(planLeadDeletion({ status: "contacted", convertedClientId: null }), { allowed: true });
  assert.deepEqual(planLeadDeletion({ status: "qualified", convertedClientId: null }), { allowed: true });
  assert.deepEqual(planLeadDeletion({ status: "lost", convertedClientId: null }), { allowed: true });
});

test("planLeadDeletion protects converted/client leads", () => {
  const client = planLeadDeletion({ status: "client", convertedClientId: 7 });
  assert.equal(client.allowed, false);
  if (!client.allowed) assert.match(client.reason, /Converted leads/);
  // Even an inconsistent state (linked client id but wrong status) is protected.
  const inconsistent = planLeadDeletion({ status: "lost", convertedClientId: 7 });
  assert.equal(inconsistent.allowed, false);
});

test("normaliseLeadEmail trims and lowercases", () => {
  assert.equal(normaliseLeadEmail("  Maya@Example.COM "), "maya@example.com");
  assert.equal(normaliseLeadEmail("MAYA@EXAMPLE.COM"), "maya@example.com");
  assert.equal(normaliseLeadEmail("  maya@example.com"), "maya@example.com");
  assert.equal(normaliseLeadEmail(null), "");
  assert.equal(normaliseLeadEmail(123), "");
});

test("planLeadResubmission creates when no lead matches", () => {
  assert.deepEqual(planLeadResubmission(null), { kind: "create" });
  assert.deepEqual(planLeadResubmission(undefined), { kind: "create" });
});

test("planLeadResubmission resubmits an active lead (no duplicate)", () => {
  for (const status of ["new", "contacted", "qualified"]) {
    assert.deepEqual(planLeadResubmission({ id: 5, status, convertedClientId: null }), { kind: "resubmitted", leadId: 5 });
  }
});

test("planLeadResubmission reactivates a lost lead", () => {
  assert.deepEqual(planLeadResubmission({ id: 9, status: "lost", convertedClientId: null }), { kind: "reactivate", leadId: 9 });
});

test("planLeadResubmission protects converted/client leads with a live client", () => {
  assert.deepEqual(planLeadResubmission({ id: 3, status: "client", convertedClientId: 7 }), { kind: "already_client", leadId: 3 });
  // Defense-in-depth: a non-null convertedClientId is protected even if status is stale.
  assert.deepEqual(planLeadResubmission({ id: 3, status: "lost", convertedClientId: 7 }), { kind: "already_client", leadId: 3 });
});

test("a converted lead whose client was deleted allows reapplication (never blocked forever)", () => {
  // Conversion sets status + convertedClientId atomically; a null reference on
  // a "client" lead means the client row was deleted (FK set null). The email
  // must be able to apply again.
  assert.deepEqual(planLeadResubmission({ id: 3, status: "client", convertedClientId: null }), { kind: "reapply", leadId: 3 });
});

test("planConversion decides create, link and already", () => {
  assert.deepEqual(planConversion({ convertedClientId: null, email: "maya@example.com" }, null), { kind: "create", email: "maya@example.com" });
  assert.deepEqual(planConversion({ convertedClientId: null, email: "maya@example.com" }, { id: 7 }), { kind: "link", clientId: 7 });
  assert.deepEqual(planConversion({ convertedClientId: 9, email: "maya@example.com" }, null), { kind: "already", clientId: 9 });
});
