import { describe, expect, it } from "vitest";
import { adaptiveLexicalScore, additiveRelevance } from "../../../src/core/retrieve/signalFusion.js";
import { linkedEntityScores } from "../../../src/core/storage/entityLinkRepo.js";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

describe("fixed adaptive and additive ranking hypotheses", () => {
  it.each([["alpha beta gamma", 5], ["alpha beta gamma delta epsilon", 7],
    ["alpha beta gamma delta epsilon zeta eta theta", 9],
    ["alpha beta gamma delta epsilon zeta eta theta iota kappa", 10],
    ["alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi", 12]])("uses a query-length midpoint for %s", (query, midpoint) => {
    expect(adaptiveLexicalScore(midpoint, query)).toBeCloseTo(0.5);
    expect(adaptiveLexicalScore(0, query)).toBe(0);
    expect(adaptiveLexicalScore(midpoint + 1000, query)).toBe(1);
  });
  it("normalizes only active signals and gates semantics before fusion", () => {
    expect(additiveRelevance({ lexical: 1 })).toBe(1);
    expect(additiveRelevance({ lexical: 1, dense: 1, entity: 0.5 })).toBe(1);
    expect(additiveRelevance({ dense: 1, entity: 0.5 })).toBe(1);
    expect(additiveRelevance({ lexical: 1, dense: 0.19, entity: 0.5 })).toBeNull();
    expect(additiveRelevance({})).toBe(0);
  });
  it("damps entity hubs, takes the maximum rather than summing, and preserves visibility", () => {
    const db = openDb();
    try {
      const now = new Date("2026-01-01T00:00:00.000Z");
      for (let n = 0; n < 40; n++) {
        const content = `Alice uses SQLite. ${n === 0 ? "Project atlas." : ""}`;
        insertMemory(db, { id: `m${n}`, project_id: "p", session_id: `s${n}`, source_adapter: "test", kind: "fact",
          content, normalized_content: content.toLowerCase(), importance: 5, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      const hub = linkedEntityScores(db, "p", "Alice SQLite", now, false, true);
      expect(hub.get("m1")).toBeCloseTo(0.5 / (1 + 0.001 * 39 ** 2));
      const rare = linkedEntityScores(db, "p", "Alice SQLite atlas", now, false, true);
      expect(rare.get("m0")).toBe(0.5);
      expect(rare.get("m1")).toBe(hub.get("m1"));
      expect(linkedEntityScores(db, "other", "Alice", now, false, true).size).toBe(0);
    } finally { db.close(); }
  });
});
