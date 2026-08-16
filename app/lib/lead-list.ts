// Pure, dependency-free helpers for lead-list query parsing, server-side
// filtering/pagination, and Europe/Paris day boundaries. Kept free of runtime
// imports so it can be unit-tested with Node's built-in test runner, matching
// the convention of client-ownership/client-dto/client-email.

// The active pipeline (the board's default columns). "client" is included so
// converted leads stay visible in the pipeline alongside the live stages.
export const ACTIVE_LEAD_STATUSES = ["new", "contacted", "qualified", "client"] as const;
// Archived = lost leads, hidden from the active pipeline by default.
export const ARCHIVED_LEAD_STATUSES = ["lost"] as const;
// Open leads still eligible for a follow-up reminder (active pipeline minus the
// converted "client" state).
export const OPEN_LEAD_STATUSES = ["new", "contacted", "qualified"] as const;

export type LeadView = "active" | "archived";

export const LEAD_PAGE_SIZE_DEFAULT = 50;
export const LEAD_PAGE_SIZE_MAX = 100;

export type LeadListQuery = {
  page: number;
  pageSize: number;
  view: LeadView;
  search: string;
  source: string;
};

// Clamps an integer query param. Invalid/missing values fall back to a safe
// default; out-of-range values are clamped. "abc" and 0 are invalid.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

export function parseLeadListQuery(params: URLSearchParams): LeadListQuery {
  return {
    page: clampInt(params.get("page"), 1, 1, 1_000_000),
    pageSize: clampInt(params.get("pageSize"), LEAD_PAGE_SIZE_DEFAULT, 1, LEAD_PAGE_SIZE_MAX),
    view: params.get("view") === "archived" ? "archived" : "active",
    search: (params.get("search") ?? "").trim().slice(0, 120),
    source: (params.get("source") ?? "").trim().slice(0, 40),
  };
}

// Statuses included by a given view. Used for server-side WHERE clauses so
// archived records never consume the active page limit.
export function viewStatuses(view: LeadView): readonly string[] {
  return view === "archived" ? ARCHIVED_LEAD_STATUSES : ACTIVE_LEAD_STATUSES;
}

// Escapes LIKE wildcards so user search input matches literally.
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Start (inclusive) and end (exclusive) of the Europe/Paris calendar day that
// contains `now`, as absolute instants. Subtracting the Paris wall-clock
// seconds-of-day from the absolute instant yields Paris midnight (offsets are
// constant within a day except across a DST transition, where one boundary is
// off by an hour — acceptable for a coarse "due today" filter).
export function parisDayBounds(now: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const secondsIntoDay = value("hour") * 3600 + value("minute") * 60 + value("second");
  const start = new Date(now.getTime() - secondsIntoDay * 1000);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}
