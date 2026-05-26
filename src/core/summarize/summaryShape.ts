import type { SessionEventRecord } from "../storage/types.js";

export type FactMode = "summary-only" | "facts-only" | "summary+facts";

export interface BuildStructuredSummaryOptions {
  factMode: FactMode;
}

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

function sectionLines(events: SessionEventRecord[], fallback: string): string[] {
  const lines = events.map(extractEventText).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [fallback];
  }
  return lines.slice(0, 3);
}

export function buildStructuredSummary(
  events: SessionEventRecord[],
  options: BuildStructuredSummaryOptions,
): string {
  const sharedLines = sectionLines(events, "No relevant events captured.");

  const summarySection = [
    "goals",
    ...sharedLines.map((line) => `- ${line}`),
    "",
    "actions",
    ...sharedLines.map((line) => `- ${line}`),
    "",
    "decisions",
    ...sharedLines.map((line) => `- ${line}`),
    "",
    "blockers",
    ...sharedLines.map((line) => `- ${line}`),
    "",
    "outcomes",
    ...sharedLines.map((line) => `- ${line}`),
  ].join("\n");

  const facts = events
    .map((event) => `- [${event.event_type}] ${extractEventText(event)}`)
    .slice(0, 5);
  const factSection = ["facts", ...facts].join("\n");

  if (options.factMode === "summary-only") {
    return summarySection;
  }
  if (options.factMode === "facts-only") {
    return factSection;
  }
  return `${summarySection}\n\n${factSection}`;
}
