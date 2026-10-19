import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { replaceMemoryKnowledge } from "../../../src/core/storage/knowledgeRepo.js";
import { linkedEntityScores } from "../../../src/core/storage/entityLinkRepo.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { searchMemoryCandidatesByIds } from "../../../src/core/storage/memorySearchRepo.js";

const now = new Date("2026-01-01T00:00:00.000Z");
describe("entity link candidate and score fusion", () => {
  it("links explicit aliases and admits candidates absent from BM25", () => {
    const db = openDb();
    try {
      for (let i = 0; i < 55; i++) {
        insertMemory(db, { id: `log-${i}`, project_id: "p", session_id: `${i}`, source_adapter: "test", kind: "fact",
          content: "Postgres status log.", normalized_content: "postgres status log", importance: 5, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      insertMemory(db, { id: "alias", project_id: "p", session_id: "a", source_adapter: "test", kind: "fact",
        content: "PostgreSQL stores the records.", normalized_content: "postgresql stores the records", importance: 5,
        created_at: now.toISOString(), updated_at: now.toISOString() });
      const request = { db, projectId: "p", query: "postgres", now, limit: 100 };
      expect(retrieveMemories(request).map(m => m.id)).not.toContain("alias");
      const scores = linkedEntityScores(db, "p", "postgres", now, false);
      expect(scores.size).toBe(56);
      expect(scores.get("log-0")).toBe(scores.get("log-54"));
      const enabled = retrieveMemories({ ...request, entityLinkBoost: true });
      expect(enabled.map(m => m.id)).toContain("alias");
      expect(new Set(enabled.map(m => m.id)).size).toBe(enabled.length);
      const candidate = searchMemoryCandidatesByIds(db, "p", ["alias"], now)[0];
      const dense = [{ candidate, similarity: 1 }];
      const fused = retrieveMemories({ ...request, entityLinkBoost: true, semanticCandidates: dense });
      expect(fused.find(m => m.id === "alias")!.score.raw.semantic)
        .toBeGreaterThan(enabled.find(m => m.id === "alias")!.score.raw.semantic);
    } finally { db.close(); }
  });
  it("weights rare linked entities and excludes expired, hidden and foreign rows", () => {
    const db = openDb();
    try {
      for (const [id, project, expires] of [["common", "p", null], ["rare", "p", null], ["both", "p", null],
        ["foreign", "other", null], ["expired", "p", "2025-01-01T00:00:00.000Z"]]) {
        insertMemory(db, { id: id!, project_id: project!, session_id: id!, source_adapter: "test", kind: "fact",
          content: "A status note.", normalized_content: "a status note", importance: 5, expires_at: expires,
          created_at: now.toISOString(), updated_at: now.toISOString() });
        replaceMemoryKnowledge(db, id!, { entities: [{ kind: "person", name: "alice" },
          ...(id !== "common" ? [{ kind: "project" as const, name: "atlas" }] : [])], relations: [] });
      }
      // One extra common-only row makes atlas the rarer name.
      insertMemory(db, { id: "common2", project_id: "p", session_id: "c2", source_adapter: "test", kind: "fact",
        content: "Alice uses SQLite.", normalized_content: "alice uses sqlite", importance: 5,
        created_at: now.toISOString(), updated_at: now.toISOString() });
      const scores = linkedEntityScores(db, "p", "Alice atlas", now, false);
      expect(scores.get("both")).toBeCloseTo(1);
      expect(scores.get("common")).toBeLessThan(0.5);
      expect(scores.has("foreign")).toBe(false);
      expect(scores.has("expired")).toBe(false);
      expect(linkedEntityScores(db, "p", "Alicia atlasian", now, false).size).toBe(0);
      const plain = { db, projectId: "p", query: "unrecognized zebra", now };
      expect(retrieveMemories({ ...plain, entityLinkBoost: true })).toEqual(retrieveMemories(plain));
    } finally { db.close(); }
  });
  it("honors history visibility before scoring entity links", () => {
    const db = openDb();
    try {
      for (const [id, content, date] of [["old", "I use VS Code.", "2025-01-01T00:00:00.000Z"],
        ["new", "I switched to Neovim.", "2025-02-01T00:00:00.000Z"]]) {
        insertMemory(db, { id, project_id: "p", session_id: id, source_adapter: "test", kind: "fact", content,
          normalized_content: content.toLowerCase(), importance: 5, created_at: date, updated_at: date });
      }
      expect(linkedEntityScores(db, "p", "VS Code", now, false).has("old")).toBe(false);
      expect(linkedEntityScores(db, "p", "VS Code", now, true).has("old")).toBe(true);
    } finally { db.close(); }
  });
  it("does not change results when the opt-in is omitted or false", () => {
    const db = openDb();
    try {
      insertMemory(db, { id: "m", project_id: "p", session_id: "s", source_adapter: "test", kind: "fact",
        content: "Alice uses SQLite.", normalized_content: "alice uses sqlite", importance: 5,
        created_at: now.toISOString(), updated_at: now.toISOString() });
      const request = { db, projectId: "p", query: "Alice SQLite", now };
      expect(retrieveMemories({ ...request, entityLinkBoost: false })).toEqual(retrieveMemories(request));
    } finally { db.close(); }
  });
});
