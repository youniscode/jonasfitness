"use client";

// Dev-only Playwright harness for the Bodyweight page. Mounts the exact
// BodyweightPanel used on /progress/bodyweight inside the exact ProgressShell,
// with /api/progress/bodyweight mocked at the fetch boundary by an in-memory
// owner-scoped store that mirrors the real routes: canonical kg storage,
// kg/lb conversion via the pure domain module, no client-supplied ownerId.
// ?seed=full|empty varies the seeded history.
import { useState } from "react";
import BodyweightPanel from "../../progress/(product)/bodyweight/BodyweightPanel";
import ProgressShell from "../../progress/(product)/ProgressShell";
import { bodyweightInputFrom, bodyweightPatchFrom, type PublicBodyweightEntry } from "../../lib/bodyweight";
import "../../progress/progress.css";

type Seed = "full" | "empty";

const SEED_ENTRIES: PublicBodyweightEntry[] = [
  { id: 1, measuredAt: "2026-07-01T12:00:00.000Z", weightKg: 84.5 },
  { id: 2, measuredAt: "2026-08-01T12:00:00.000Z", weightKg: 82.1 },
  { id: 3, measuredAt: "2026-09-01T12:00:00.000Z", weightKg: 90.7 },
];

function createStore(seed: Seed) {
  const store = { nextId: 10, rows: seed === "full" ? [...SEED_ENTRIES] : [] as PublicBodyweightEntry[] };
  const sort = () => store.rows.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt) || b.id - a.id);
  return {
    list: () => Response.json({ entries: sort() }, { status: 200, headers: { "content-type": "application/json" } }),
    create: async (body: Record<string, unknown>) => {
      const parsed = bodyweightInputFrom(body, new Date().toISOString());
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: { "content-type": "application/json" } });
      const entry = { id: store.nextId++, measuredAt: parsed.measuredAt, weightKg: parsed.weightKg };
      store.rows.push(entry);
      return Response.json({ entry }, { status: 201, headers: { "content-type": "application/json" } });
    },
    update: async (id: number, body: Record<string, unknown>) => {
      const parsed = bodyweightPatchFrom({ ...body, id }, new Date().toISOString());
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: { "content-type": "application/json" } });
      const entry = store.rows.find((row) => row.id === id);
      if (!entry) return Response.json({ error: "Measurement not found." }, { status: 404, headers: { "content-type": "application/json" } });
      entry.weightKg = parsed.weightKg;
      entry.measuredAt = parsed.measuredAt;
      return Response.json({ entry }, { status: 200, headers: { "content-type": "application/json" } });
    },
    remove: (id: number) => {
      const before = store.rows.length;
      store.rows = store.rows.filter((row) => row.id !== id);
      if (store.rows.length === before) return Response.json({ error: "Measurement not found." }, { status: 404, headers: { "content-type": "application/json" } });
      return Response.json({ ok: true }, { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

function installMockFetch(seed: Seed) {
  const server = createStore(seed);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/progress/bodyweight")) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const method = init?.method ?? "GET";
    const body = method === "GET" ? {} : JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const idMatch = /\/api\/progress\/bodyweight\/(\d+)$/.exec(url);
    if (method === "GET") return server.list();
    if (method === "POST") return server.create(body);
    if (method === "PATCH" && idMatch) return server.update(Number(idMatch[1]), body);
    if (method === "DELETE" && idMatch) return server.remove(Number(idMatch[1]));
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
}

export default function ProgressBodyweightHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Harness />;
}

function Harness() {
  const [ready] = useState(() => {
    const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("seed") : null;
    installMockFetch(requested === "empty" ? "empty" : "full");
    return true;
  });
  if (!ready) return null;
  return (
    <ProgressShell>
      <BodyweightPanel />
    </ProgressShell>
  );
}