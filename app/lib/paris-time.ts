// Pure, dependency-free Europe/Paris wall-clock helpers (Intl only). The coach
// operates in Europe/Paris, so consultation/follow-up dates are picked and
// displayed on the Paris calendar regardless of where the coach's browser is.
// Kept free of runtime imports so it can be unit-tested with Node's built-in
// test runner, matching the convention of lead-list/notification-evaluation.
export const COACH_TIME_ZONE = "Europe/Paris";

export type ParisWallClock = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

// The wall-clock fields of an instant on the Europe/Paris calendar. `hourCycle:
// "h23"` keeps midnight at "00" (never "24"), and en-CA yields YYYY-MM-DD order.
export function parisWallClockParts(date: Date): ParisWallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COACH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

// The value a datetime-local input should hold to represent this instant, i.e.
// its Europe/Paris wall clock ("YYYY-MM-DDTHH:mm"). Using the Paris wall clock
// instead of the browser's local time keeps the booking independent of where
// the coach's device is.
export function parisInputValue(date: Date): string {
  const parts = parisWallClockParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// The UTC instant whose Europe/Paris wall clock equals the given datetime-local
// value ("YYYY-MM-DDTHH:mm"), or null when malformed. The Paris offset (CET
// UTC+1 / CEST UTC+2) depends on the instant, so the conversion iterates: it
// shifts the guess by the wall-clock error until it converges (a couple of
// iterations; Paris offsets change by at most one hour). Two DST cases are
// resolved deterministically: a nonexistent spring-forward time (the wall
// clock never occurs) snaps forward to the closest instant, like browsers do;
// an ambiguous fall-back time (the wall clock occurs twice) resolves to the
// later (CET) instant. Either choice is safe here because the server and UI
// share this function, so what the coach picks is exactly what is stored.
export function parisFromInput(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const wallMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let guess = new Date(wallMs);
  const visited: Date[] = [];
  for (let i = 0; i < 6; i += 1) {
    if (visited.some((item) => item.getTime() === guess.getTime())) {
      // Oscillation around a DST transition (nonexistent gap time): return the
      // visited instant whose Paris wall clock is closest to the target,
      // breaking ties toward the later instant (snap forward).
      let best: Date | null = null;
      let bestDiff = Infinity;
      for (const candidate of visited) {
        const parts = parisWallClockParts(candidate);
        const candidateWall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
        const diff = Math.abs(candidateWall - wallMs);
        if (diff < bestDiff || (best !== null && diff === bestDiff && candidate.getTime() > best.getTime())) {
          best = candidate;
          bestDiff = diff;
        }
      }
      return best;
    }
    visited.push(guess);
    const current = parisWallClockParts(guess);
    const guessWallMs = Date.UTC(
      Number(current.year),
      Number(current.month) - 1,
      Number(current.day),
      Number(current.hour),
      Number(current.minute),
    );
    const delta = wallMs - guessWallMs;
    if (delta === 0) return guess;
    guess = new Date(guess.getTime() + delta);
  }
  return null;
}

// Human-readable Paris-time rendering for display. `language` follows the app's
// coach-facing locale convention (fr/en/ar fall back to English).
export function formatParisDateTime(value: string | Date, language = "en"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const locale = language === "ar" ? "ar" : language === "fr" ? "fr-FR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: COACH_TIME_ZONE,
  }).format(date);
}

// Compact Paris-time rendering for badges ("18 Aug, 14:30").
export function formatParisShort(value: string | Date, language = "en"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const locale = language === "ar" ? "ar" : language === "fr" ? "fr-FR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: COACH_TIME_ZONE,
  }).format(date);
}

// The instant exactly `days` Paris calendar days after `now`, keeping the same
// Paris wall-clock time. DST-safe: adding a calendar day across a transition
// lands on the same wall time (which may be a different UTC offset).
export function parisInDays(now: Date, days: number): Date {
  const current = parisWallClockParts(now);
  // Shift the Paris wall-clock DATE by `days` (wall-field arithmetic), then
  // re-attach the original wall time and convert back to a UTC instant.
  const shiftedDate = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day) + days));
  const shiftedParts = parisWallClockParts(shiftedDate);
  const parsed = parisFromInput(`${shiftedParts.year}-${shiftedParts.month}-${shiftedParts.day}T${current.hour}:${current.minute}`);
  return parsed ?? now;
}
