import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";

describe("entity overlap ranking", () => {
  it("adds entity overlap alongside tied BM25 scores and preserves the public score shape", () => {
    const db = openDb();
    const now = new Date("2026-01-01T00:00:00.000Z");
    try {
      for (const [id, content] of [["a", "Alice? Uses SQLite."], ["z", "Alice uses SQLite."]]) {
        insertMemory(db, { id, content, project_id: "p", session_id: "s", source_adapter: "test", kind: "fact",
          normalized_content: content.toLowerCase(), importance: 5, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      const results = retrieveMemories({ db, projectId: "p", query: "Alice SQLite", now });
      expect(results.map(row => row.id)).toEqual(["z", "a"]);
      expect(results[0].score.raw.semantic).toBe(1);
      expect(results[1].score.raw.semantic).toBeCloseTo(0.95);
      expect(Object.keys(results[0].score).sort()).toEqual(["raw", "total", "weighted"]);
      expect(retrieveMemories({ db, projectId: "other", query: "Alice SQLite", now })).toEqual([]);
    } finally { db.close(); }
  });
});
