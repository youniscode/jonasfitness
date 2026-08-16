import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_LEAD_STATUSES,
  ARCHIVED_LEAD_STATUSES,
  escapeLike,
  LEAD_PAGE_SIZE_DEFAULT,
  LEAD_PAGE_SIZE_MAX,
  OPEN_LEAD_STATUSES,
  parseLeadListQuery,
  parisDayBounds,
  viewStatuses,
} from "../app/lib/lead-list.ts";

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
