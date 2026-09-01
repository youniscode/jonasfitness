import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateAcquisition, type AcquisitionRow } from "../app/lib/attribution.ts";

// Rows are newest-first, matching the API query (order by createdAt desc).
function row(overrides: Partial<AcquisitionRow> & { id: number; createdAt: Date | string }): AcquisitionRow {
  return { name: `Client ${overrides.id}`, source: "Direct", campaign: "", ...overrides };
}

// Newest-first, matching the API query (order by createdAt desc).
const existing = [
  row({ id: 3, name: "Maya H.", source: "Instagram", createdAt: new Date("2026-08-10T10:00:00.000Z") }),
  row({ id: 2, name: "Samir K.", source: "Google Search", createdAt: new Date("2026-08-05T10:00:00.000Z") }),
  row({ id: 1, name: "Younis M.", source: "Instagram", campaign: "instagram-profile", createdAt: new Date("2026-08-01T10:00:00.000Z") }),
];

test("a converted client is included in totals, source buckets and recent clients", () => {
  const converted = row({ id: 4, name: "Mohamed Ali ALI", source: "Direct", createdAt: new Date("2026-08-16T10:00:00.000Z") });
  const summary = aggregateAcquisition([converted, ...existing]);
  assert.equal(summary.total, 4);
  assert.equal(summary.tracked, 4); // Direct is a known source
  assert.deepEqual(summary.recent[0], {
    id: 4,
    name: "Mohamed Ali ALI",
    source: "Direct",
    campaign: "",
    createdAt: converted.createdAt,
  });
  const direct = summary.sources.find((item) => item.source === "Direct");
  assert.equal(direct?.count, 1);
  const instagram = summary.sources.find((item) => item.source === "Instagram");
  assert.equal(instagram?.count, 2);
});

test("recent clients lists the newest converted client first, then existing clients", () => {
  const converted = row({ id: 5, name: "New Client", source: "WhatsApp", createdAt: new Date("2026-08-16T12:00:00.000Z") });
  const summary = aggregateAcquisition([converted, ...existing]);
  assert.deepEqual(summary.recent.map((item) => item.id), [5, 3, 2, 1]);
});

test("each client counts exactly once - no duplicate totals after idempotent conversion", () => {
  // The conversion find-or-create guarantees one row per client; aggregation
  // must never double-count even if the same source appears many times.
  const many = [
    ...existing,
    row({ id: 4, name: "A", source: "Instagram", createdAt: new Date("2026-08-12T10:00:00.000Z") }),
    row({ id: 5, name: "B", source: "Instagram", createdAt: new Date("2026-08-13T10:00:00.000Z") }),
  ];
  const summary = aggregateAcquisition(many);
  assert.equal(summary.total, 5);
  // Two Instagram rows in the fixture plus the two new ones.
  assert.equal(summary.sources.find((item) => item.source === "Instagram")?.count, 4);
});

test("tracked excludes Unknown and topSource picks the most common known source", () => {
  const summary = aggregateAcquisition([
    ...existing,
    row({ id: 4, name: "U", source: "Unknown", createdAt: new Date("2026-08-15T10:00:00.000Z") }),
  ]);
  assert.equal(summary.tracked, 3);
  assert.equal(summary.topSource, "Instagram"); // 2 vs Google Search 1
});

test("sources are sorted by count descending, then alphabetically", () => {
  // existing already has two Instagram rows; the added one makes three.
  const summary = aggregateAcquisition([...existing, row({ id: 4, name: "C", source: "Instagram", createdAt: new Date("2026-08-12T10:00:00.000Z") })]);
  assert.deepEqual(summary.sources, [
    { source: "Instagram", count: 3 },
    { source: "Google Search", count: 1 },
  ]);
});

test("an empty roster yields zero totals and no source data", () => {
  const summary = aggregateAcquisition([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.tracked, 0);
  assert.deepEqual(summary.sources, []);
  assert.equal(summary.topSource, "Not enough data");
  assert.deepEqual(summary.recent, []);
});
