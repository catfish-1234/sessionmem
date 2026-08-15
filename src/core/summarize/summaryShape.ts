import type { SessionEventRecord } from "../storage/types.js";

export type FactMode = "summary-only" | "facts-only" | "summary+facts";

export interface BuildStructuredSummaryOptions {
  factMode: FactMode;
}

/** Max distinct lines rendered per section. */
const MAX_SECTION_LINES = 5;

/** Max `- [type] text` fact lines in the facts section. */
const MAX_FACT_LINES = 8;

/**
 * Human-readable text for an event. The auto-ingest hook writes a `text` field
 * carrying a one-line description ("Ran: npm test", "Edited src/foo.ts"); fall
 * back to the raw payload for events written by other producers.
 */
function extractEventText(event: SessionEventRecord): string {
  try {
    const parsed = JSON.parse(event.payload_json) as { text?: string };
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return parsed.text.trim();
    }
  } catch {
    // fall through to raw payload
  }

  return event.payload_json.trim();
}

/** Distinct, non-empty lines, preserving first-seen order. */
function distinctLines(events: SessionEventRecord[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const event of events) {
    const line = extractEventText(event);
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

function section(title: string, lines: string[], fallback: string): string[] {
  const body = lines.length > 0 ? lines : [fallback];
  return [title, ...body.map((line) => `- ${line}`)];
}

/**
 * Render the session's events as a structured summary.
 *
 * Sections carry DIFFERENT slices of the session rather than the same lines
 * repeated under every heading: `actions` is what happened in order, `outcomes`
 * is where the session ended up, and `decisions` surfaces the events that
 * recorded a choice (git commits). Repeating one slice under all five headings
 * produced a summary that cost five times the tokens and carried no extra
 * signal — and, once stored, was what every later session got injected with.
 */
export function buildStructuredSummary(
  events: SessionEventRecord[],
  options: BuildStructuredSummaryOptions,
): string {
  const lines = distinctLines(events);

  // Ordered narrative of the session, capped from the front.
  const actions = lines.slice(0, MAX_SECTION_LINES);
  // Where the session ended up: the tail, which is the most recent state.
  const outcomes =
    lines.length > MAX_SECTION_LINES
      ? lines.slice(-Math.min(MAX_SECTION_LINES, lines.length - MAX_SECTION_LINES))
      : lines.slice(-1);
  // Commits are the durable decisions a session leaves behind.
  const decisions = lines
    .filter((line) => /\bgit\s+commit\b/i.test(line))
    .slice(0, MAX_SECTION_LINES);

  const summarySection = [
    ...section("actions", actions, "No relevant events captured."),
    "",
    ...section("decisions", decisions, "No explicit decisions recorded."),
    "",
    ...section("outcomes", outcomes, "No outcomes captured."),
  ].join("\n");

  const facts = events
    .slice(0, MAX_FACT_LINES)
    .map((event) => `- [${event.event_type}] ${extractEventText(event)}`);
  const factSection = ["facts", ...facts].join("\n");

  if (options.factMode === "summary-only") {
    return summarySection;
  }
  if (options.factMode === "facts-only") {
    return factSection;
  }
  return `${summarySection}\n\n${factSection}`;
}
