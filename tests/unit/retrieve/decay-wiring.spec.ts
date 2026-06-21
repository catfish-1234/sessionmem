import { describe, expect, it } from "vitest";

import { decayOldBoosts } from "../../../src/core/retrieve/decay.js";
import { scoreMemoryCandidate } from "../../../src/core/retrieve/score.js";

describe("decay wiring into scoring pipeline", () => {
  it("memory updated 10 days ago scores lower on importance than same memory updated today", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");

    const memories = [
      {
        id: "old-memory",
        importance: 8,
        updated_at: "2026-06-05T12:00:00.000Z", // 10 days ago
      },
      {
        id: "fresh-memory",
        importance: 8,
        updated_at: "2026-06-15T12:00:00.000Z", // today
      },
    ];

    const decayed = decayOldBoosts(memories, now);

    const oldMemory = decayed.find((m) => m.id === "old-memory")!;
    const freshMemory = decayed.find((m) => m.id === "fresh-memory")!;

    // 10 days ago exceeds the 7-day threshold, so importance decays from 8 to 7
    expect(oldMemory.decayedImportance).toBe(7);
    // Fresh memory stays at 8
    expect(freshMemory.decayedImportance).toBe(8);

    // When wired into scoring, the old memory gets a lower importance score
    const oldScore = scoreMemoryCandidate(
      {
        semantic: 0.5,
        updated_at: oldMemory.updated_at,
        importance: oldMemory.importance,
        decayedImportance: oldMemory.decayedImportance,
      },
      now,
    );

    const freshScore = scoreMemoryCandidate(
      {
        semantic: 0.5,
        updated_at: freshMemory.updated_at,
        importance: freshMemory.importance,
        decayedImportance: freshMemory.decayedImportance,
      },
      now,
    );

    // The importance component should be lower for the old memory
    expect(oldScore.raw.importance).toBeLessThan(freshScore.raw.importance);
    expect(oldScore.weighted.importance).toBeLessThan(freshScore.weighted.importance);
  });

  it("scoreMemoryCandidate falls back to importance when decayedImportance is not provided", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");

    const withDecay = scoreMemoryCandidate(
      {
        semantic: 0.5,
        updated_at: "2026-06-15T12:00:00.000Z",
        importance: 8,
        decayedImportance: 6,
      },
      now,
    );

    const withoutDecay = scoreMemoryCandidate(
      {
        semantic: 0.5,
        updated_at: "2026-06-15T12:00:00.000Z",
        importance: 8,
      },
      now,
    );

    // Without decayedImportance, should use importance (8), resulting in higher score
    expect(withoutDecay.raw.importance).toBeGreaterThan(withDecay.raw.importance);
  });
});
