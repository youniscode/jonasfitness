import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_LEAD_STATUSES,
  ARCHIVED_LEAD_STATUSES,
  escapeLike,
  LEAD_PAGE_SIZE_DEFAULT,
  LEAD_PAGE_SIZE_MAX,
  NEW_LEADS_ATTENTION_LIMIT,
  newLeadsAttention,
  OPEN_LEAD_STATUSES,
  parseLeadListQuery,
  parisDayBounds,
  viewStatuses,
} from "../app/lib/lead-list.ts";
import type { NewLeadAttentionRow } from "../app/lib/lead-list.ts";

test("parseLeadListQuery applies default page and pageSize", () => {
  const query = parseLeadListQuery(new URLSearchParams());
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, LEAD_PAGE_SIZE_DEFAULT);
  assert.equal(query.view, "active");
  assert.equal(query.search, "");
  assert.equal(query.source, "");
});

test("parseLeadListQuery clamps pageSize to the maximum", () => {
  const query = parseLeadListQuery(new URLSearchParams({ pageSize: "1000" }));
  assert.equal(query.pageSize, LEAD_PAGE_SIZE_MAX);
});

test("parseLeadListQuery rejects invalid page and pageSize with safe defaults", () => {
  assert.equal(parseLeadListQuery(new URLSearchParams({ page: "abc" })).page, 1);
  assert.equal(parseLeadListQuery(new URLSearchParams({ page: "0" })).page, 1);
  assert.equal(parseLeadListQuery(new URLSearchParams({ page: "-3" })).page, 1);
  assert.equal(parseLeadListQuery(new URLSearchParams({ pageSize: "abc" })).pageSize, LEAD_PAGE_SIZE_DEFAULT);
  assert.equal(parseLeadListQuery(new URLSearchParams({ pageSize: "0" })).pageSize, LEAD_PAGE_SIZE_DEFAULT);
  assert.equal(parseLeadListQuery(new URLSearchParams({ pageSize: "-1" })).pageSize, LEAD_PAGE_SIZE_DEFAULT);
});

test("parseLeadListQuery parses view, search and source with normalization", () => {
  const query = parseLeadListQuery(new URLSearchParams({ view: "archived", search: "  Maya H. ", source: " Instagram " }));
  assert.equal(query.view, "archived");
  assert.equal(query.search, "Maya H."); // trimmed only; matching is ilike (case-insensitive)
  assert.equal(query.source, "Instagram");
  // Unknown view falls back to active.
  assert.equal(parseLeadListQuery(new URLSearchParams({ view: "bogus" })).view, "active");
});

test("viewStatuses separates active pipeline from archived", () => {
  assert.deepEqual([...viewStatuses("active")], [...ACTIVE_LEAD_STATUSES]);
  assert.deepEqual([...viewStatuses("archived")], [...ARCHIVED_LEAD_STATUSES]);
  assert.equal(viewStatuses("active").includes("client"), true);
  assert.equal(viewStatuses("active").includes("lost"), false);
  assert.equal(viewStatuses("archived").includes("lost"), true);
});

test("OPEN_LEAD_STATUSES excludes client and lost", () => {
  assert.deepEqual([...OPEN_LEAD_STATUSES], ["new", "contacted", "qualified"]);
});

test("escapeLike neutralizes LIKE wildcards", () => {
  assert.equal(escapeLike("maya@example.com"), "maya@example.com");
  assert.equal(escapeLike("100%"), "100\\%");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("a\\b"), "a\\\\b");
});

test("parisDayBounds is deterministic and spans one Paris calendar day", () => {
  const now = new Date("2026-08-16T22:30:00.000Z"); // 00:30 Paris (CEST, UTC+2)
  const { start, end } = parisDayBounds(now);
  assert.equal(end.getTime() - start.getTime(), 24 * 3600 * 1000);
  assert.ok(now.getTime() >= start.getTime() && now.getTime() < end.getTime());

  // Winter instant: 2026-01-15T23:00Z = 00:00 Paris (CET, UTC+1).
  const winter = new Date("2026-01-15T23:00:00.000Z");
  const winterBounds = parisDayBounds(winter);
  assert.equal(winterBounds.start.toISOString(), "2026-01-15T23:00:00.000Z");

  // Summer instant: 2026-08-15T22:00Z = 00:00 Paris (CEST, UTC+2).
  const summer = new Date("2026-08-15T22:00:00.000Z");
  const summerBounds = parisDayBounds(summer);
  assert.equal(summerBounds.start.toISOString(), "2026-08-15T22:00:00.000Z");
});

// ---------- New-leads attention (Sales Today "NEW LEADS WAITING" panel) ----------

function leadRow(overrides: Partial<NewLeadAttentionRow> = {}): NewLeadAttentionRow {
  return {
    id: 1,
    name: "Younis MOHAMMAD",
    status: "new",
    acquisitionSource: "Referral",
    goal: "Fat loss",
    createdAt: new Date("2026-08-16T08:00:00.000Z"),
    ...overrides,
  };
}

test("newLeadsAttention surfaces only status=new leads, newest first", () => {
  const rows = [
    leadRow({ id: 1, name: "Older", createdAt: new Date("2026-08-15T08:00:00.000Z") }),
    leadRow({ id: 2, name: "Newer", createdAt: new Date("2026-08-16T08:00:00.000Z") }),
  ];
  const result = newLeadsAttention(rows);
  assert.deepEqual(result.map((row) => row.id), [2, 1]);
});

test("newLeadsAttention represents multiple new leads", () => {
  const rows = [1, 2, 3, 4, 5].map((id) => leadRow({ id, createdAt: new Date(Date.UTC(2026, 7, 16, 0, 0, id)) }));
  const result = newLeadsAttention(rows);
  assert.equal(result.length, 5);
  assert.deepEqual(new Set(result.map((row) => row.id)), new Set([1, 2, 3, 4, 5]));
});

test("contacted/qualified/client/lost leads never appear in attention", () => {
  const rows = [
    leadRow({ id: 1, status: "contacted" }),
    leadRow({ id: 2, status: "qualified" }),
    leadRow({ id: 3, status: "client" }),
    leadRow({ id: 4, status: "lost" }),
    leadRow({ id: 5, status: "new" }),
  ];
  const result = newLeadsAttention(rows);
  assert.deepEqual(result.map((row) => row.id), [5]);
});

test("newLeadsAttention is bounded to the panel limit", () => {
  const rows = Array.from({ length: NEW_LEADS_ATTENTION_LIMIT + 20 }, (_, index) =>
    leadRow({ id: index + 1, createdAt: new Date(Date.UTC(2026, 7, 16, 0, 0, index)) }));
  assert.equal(newLeadsAttention(rows).length, NEW_LEADS_ATTENTION_LIMIT);
});

test("newLeadsAttention does not mutate its input (concurrent-poll safe)", () => {
  const rows = [
    leadRow({ id: 1, createdAt: new Date("2026-08-15T08:00:00.000Z") }),
    leadRow({ id: 2, createdAt: new Date("2026-08-16T08:00:00.000Z") }),
  ];
  const before = JSON.stringify(rows);
  newLeadsAttention(rows);
  assert.equal(JSON.stringify(rows), before);
});
