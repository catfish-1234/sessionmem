import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

describe("measured ranking defaults", () => {
  it("uses coverage for BM25 and unavailable inference, but preserves active hybrid and explicit overrides", async () => {
    const db = openDb();
    const dir = mkdtempSync(join(tmpdir(), "sessionmem-ranking-default-"));
    const path = join(dir, "config.json");
    const now = new Date("2026-01-01T00:00:00.000Z");
    try {
      for (const [id, content] of [["a", "Alice? Uses SQLite."], ["z", "Alice uses SQLite."]]) {
        insertMemory(db, { id, content, normalized_content: content.toLowerCase(), project_id: "p", session_id: id,
          source_adapter: "test", kind: "fact", importance: 5, created_at: now.toISOString(), updated_at: now.toISOString() });
      }
      const request = { projectId: "p", query: "Alice SQLite", mode: "on-demand" as const };
      const service = createMemoryCoreService({ db, now: () => now, policyConfigPath: path, semanticEmbedder: null });
      const baseline = await service.retrieveMemories(request);
      expect(baseline.memories.find(m => m.id === "a")!.score.raw.semantic).toBeLessThan(0.95);
      writeFileSync(path, JSON.stringify({ semanticSearch: true }));
      expect((await service.retrieveMemories(request)).memories).toEqual(baseline.memories);
      const hybrid = createMemoryCoreService({ db, now: () => now, policyConfigPath: path,
        semanticEmbedder: { id: "test-default", dimension: 2, embed: async () => [1, 0] } });
      expect((await hybrid.retrieveMemories(request)).memories.find(m => m.id === "a")!.score.raw.semantic).toBeCloseTo(0.95);
      writeFileSync(path, JSON.stringify({ entityLinkBoost: false }));
      expect((await service.retrieveMemories(request)).memories.find(m => m.id === "a")!.score.raw.semantic).toBeCloseTo(0.95);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
