import { describe, expect, it } from "vitest";
import { detectTemporalIntent, temporalRelevance } from "../../../src/core/retrieve/temporalIntent.js";

const now = new Date("2026-03-03T12:00:00.000Z");
describe("deterministic temporal intent", () => {
  it.each(["database connection settings", "What does Alice prefer?", "show customer changes", "Snow is falling"])("leaves uncued query unchanged: %s", query => {
    expect(detectTemporalIntent(query, now).kind).toBe("none");
  });
  it.each(["current database", "what do we use now?", "latest deployment", "today's status"])("recognizes current state: %s", query => {
    expect(detectTemporalIntent(query, now).kind).toBe("current");
  });
  it("prefers historical clauses over current cues", () => {
    expect(detectTemporalIntent("What did we use before the current database?", now)).toEqual({ kind: "past", previous: true });
    expect(detectTemporalIntent("When did Alice move?", now)).toEqual({ kind: "past" });
  });
  it.each([
    ["last month", "2026-02-01", "2026-03-01"],
    ["last week", "2026-02-23", "2026-03-02"],
    ["last year", "2025-01-01", "2026-01-01"],
    ["yesterday", "2026-03-02", "2026-03-03"],
    ["2 days ago", "2026-03-01", "2026-03-02"],
    ["in 2024", "2024-01-01", "2025-01-01"],
    ["on 2024-02-29", "2024-02-29", "2024-03-01"],
    ["during 2024-02", "2024-02-01", "2024-03-01"],
  ])("resolves %s against the injected UTC clock", (query, start, end) => {
    expect(detectTemporalIntent(query, now)).toEqual({ kind: "past", start: Date.parse(start), end: Date.parse(end) });
  });
  it("rejects invalid calendar dates and handles January rollover", () => {
    expect(detectTemporalIntent("on 2025-02-29", now).kind).toBe("none");
    expect(detectTemporalIntent("last month", new Date("2026-01-31T00:00:00Z")))
      .toEqual({ kind: "past", start: Date.parse("2025-12-01"), end: Date.parse("2026-01-01") });
  });
  it("uses observation time and supersession as bounded signals", () => {
    const current = detectTemporalIntent("current", now);
    expect(temporalRelevance(current, now.toISOString(), 0, now)).toBe(1);
    expect(temporalRelevance(current, now.toISOString(), 1, now)).toBe(0.5);
    const past = detectTemporalIntent("last month", now);
    expect(temporalRelevance(past, "2026-02-10", 1, now)).toBe(1);
    expect(temporalRelevance(past, "2025-01-01", 0, now)).toBeLessThan(1);
  });
});
