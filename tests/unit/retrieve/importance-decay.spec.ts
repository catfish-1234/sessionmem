import { describe, expect, it } from "vitest";

import { decayOldBoosts } from "../../../src/core/retrieve/decay.js";

describe("decayOldBoosts", () => {
  it("lowers importance for memories boosted beyond the threshold", () => {
    const now = new Date("2026-06-03T12:00:00.000Z");

    const decayed = decayOldBoosts(
      [
        {
          id: "old",
          importance: 8,
          updated_at: "2026-05-20T12:00:00.000Z",
        },
        {
          id: "fresh",
          importance: 8,
          updated_at: "2026-06-01T12:00:00.000Z",
        },
      ],
      now,
    );

    expect(decayed.find((memory) => memory.id === "old")?.decayedImportance).toBe(
      7,
    );
    expect(
      decayed.find((memory) => memory.id === "fresh")?.decayedImportance,
    ).toBe(8);
  });

  it("never decays below minimum importance", () => {
    const [memory] = decayOldBoosts(
      [
        {
          id: "minimum",
          importance: 1,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      new Date("2026-06-03T12:00:00.000Z"),
    );

    expect(memory.decayedImportance).toBe(1);
  });
});
