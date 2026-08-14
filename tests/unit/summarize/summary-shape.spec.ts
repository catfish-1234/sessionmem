import { describe, expect, it } from "vitest";
import { buildStructuredSummary } from "../../../src/core/summarize/summaryShape.js";
import type { SessionEventRecord } from "../../../src/core/storage/types.js";

function event(index: number, text: string): SessionEventRecord {
  return {
    id: `evt-${index}`,
    project_id: "p",
    session_id: "s",
    event_index: index,
    event_type: "tool_use:bash",
    payload_json: JSON.stringify({ tool: "Bash", text }),
    created_at: "2026-06-01T00:00:00.000Z",
  };
}

describe("buildStructuredSummary", () => {
  const events = [
    event(0, "Ran: npm ci"),
    event(1, "Edited src/a.ts"),
    event(2, "Ran: npm test"),
    event(3, "Edited src/b.ts"),
    event(4, "Ran: git commit -m 'fix ingest'"),
    event(5, "Ran: git push"),
  ];

  it("prefers the event's human-readable text over the raw payload", () => {
    const summary = buildStructuredSummary(events, { factMode: "summary-only" });
    expect(summary).toContain("Ran: npm ci");
    expect(summary).not.toContain("payload_json");
    expect(summary).not.toContain('{"tool"');
  });

  it("gives each section distinct content instead of repeating one slice", () => {
    const summary = buildStructuredSummary(events, { factMode: "summary-only" });
    const sectionBody = (name: string): string =>
      summary.split(`${name}\n`)[1]?.split("\n\n")[0] ?? "";

    const actions = sectionBody("actions");
    const outcomes = sectionBody("outcomes");
    const decisions = sectionBody("decisions");

    // Repeating the same lines under every heading multiplied the token cost
    // of every stored summary without adding signal.
    expect(actions).not.toBe(outcomes);
    expect(actions).not.toBe(decisions);
    // Commits are surfaced as the session's decisions.
    expect(decisions).toContain("git commit");
    // Outcomes reflect the end of the session, not its start.
    expect(outcomes).toContain("git push");
  });

  it("deduplicates repeated events", () => {
    const repeated = [event(0, "Ran: npm test"), event(1, "Ran: npm test")];
    const summary = buildStructuredSummary(repeated, { factMode: "summary-only" });
    expect(summary.match(/Ran: npm test/g)?.length).toBe(2); // actions + outcomes
  });

  it("honors factMode", () => {
    expect(buildStructuredSummary(events, { factMode: "facts-only" })).toMatch(
      /^facts\n/,
    );
    expect(
      buildStructuredSummary(events, { factMode: "summary-only" }),
    ).not.toContain("\nfacts\n");
    expect(buildStructuredSummary(events, { factMode: "summary+facts" })).toContain(
      "\nfacts\n",
    );
  });

  it("falls back to placeholders with no events", () => {
    const summary = buildStructuredSummary([], { factMode: "summary-only" });
    expect(summary).toContain("No relevant events captured.");
  });
});
