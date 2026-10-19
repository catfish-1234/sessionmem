/** Deterministic cues only. Ambiguous questions retain the ordinary ranker. */
export interface TemporalIntent {
  kind: "none" | "current" | "past";
  previous?: boolean;
  start?: number;
  end?: number;
}
const DAY = 86_400_000;

function range(start: number, end: number): TemporalIntent {
  return { kind: "past", start, end };
}

export function detectTemporalIntent(query: string, now: Date): TemporalIntent {
  const text = query.normalize("NFKC").toLowerCase();
  // A dated or historical clause takes precedence over a current-state cue.
  const iso = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(text);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]) - 1, day = Number(iso[3] ?? 1);
    const start = Date.UTC(year, month, day);
    const date = new Date(start);
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
      return range(start, iso[3] ? start + DAY : Date.UTC(year, month + 1, 1));
    }
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (/\byesterday\b/.test(text)) return range(today - DAY, today);
  const relative = /\b(?:last|previous) (week|month|year)\b/.exec(text);
  if (relative) {
    const year = now.getUTCFullYear(), month = now.getUTCMonth();
    if (relative[1] === "month") return range(Date.UTC(year, month - 1, 1), Date.UTC(year, month, 1));
    if (relative[1] === "year") return range(Date.UTC(year - 1, 0, 1), Date.UTC(year, 0, 1));
    // Calendar weeks start on Monday, in UTC.
    const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
    return range(monday - 7 * DAY, monday);
  }
  const ago = /\b(\d{1,3}) (day|week)s? ago\b/.exec(text);
  if (ago) {
    const start = today - Number(ago[1]) * (ago[2] === "week" ? 7 : 1) * DAY;
    return range(start, start + (ago[2] === "week" ? 7 : 1) * DAY);
  }
  const year = /\b(?:in|during) ((?:19|20)\d{2})\b/.exec(text);
  if (year) return range(Date.UTC(Number(year[1]), 0, 1), Date.UTC(Number(year[1]) + 1, 0, 1));
  if (/\b(before|previously|formerly|prior|used to|no longer)\b/.test(text)) return { kind: "past", previous: true };
  if (/\b(when (?:did|was|were)|in the past|historical|history)\b/.test(text)) return { kind: "past" };
  if (/\b(current|currently|now|latest|today|at present)\b/.test(text)) return { kind: "current" };
  return { kind: "none" };
}

/** A bounded signal, separate from lexical relevance. Missing dates stay neutral. */
export function temporalRelevance(intent: TemporalIntent, timestamp: string, supersededFraction: number, now: Date): number {
  const time = Date.parse(timestamp);
  if (intent.kind === "current") {
    const freshness = Number.isFinite(time) ? 1 / (1 + Math.max(0, now.getTime() - time) / (30 * DAY)) : 0.5;
    return (1 - supersededFraction + freshness) / 2;
  }
  if (intent.start !== undefined && intent.end !== undefined && Number.isFinite(time)) {
    const distance = time < intent.start ? intent.start - time : time >= intent.end ? time - intent.end + 1 : 0;
    return 1 / (1 + distance / (30 * DAY));
  }
  return intent.previous ? supersededFraction : 0.5;
}
