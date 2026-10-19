import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { indexSemanticMemories, searchSemanticMemories } from "../../../src/core/storage/semanticSearchRepo.js";
import type { LocalSemanticEmbedder } from "../../../src/core/embed/localSemanticEmbedder.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function config(enabled: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "semantic-test-")); dirs.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ retentionDays: 0, semanticSearch: enabled }));
  return path;
}
const model = (id = "test-v1"): LocalSemanticEmbedder => ({ id, dimension: 2,
  embed: vi.fn(async text => text.includes("automobile") || text === "car" ? [1, 0] : [0, 1]) });
const capture = (id: string, content: string, projectId = "p") => ({
  memoryId: id, content, projectId, sessionId: "s", sourceAdapter: "test", kind: "fact" as const, importance: 5,
});

describe("optional local semantic retrieval", () => {
  it("admits old semantic evidence outside the lexical and recency candidate sets", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, policyConfigPath: config(true), semanticEmbedder: model(), now: () => now });
      await service.storeMemory(capture("old", "An automobile engine was repaired."));
      db.prepare("UPDATE memories SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = 'old'").run();
      await service.storeMemory(capture("recent", "We discussed lunch."));
      const result = await service.retrieveMemories({ projectId: "p", query: "car", mode: "on-demand", limit: 1 });
      expect(result.memories.map(m => m.id)).toEqual(["old"]);
    } finally { db.close(); }
  });

  it("enforces project, expiry and supersession visibility for dense candidates", async () => {
    const db = openDb();
    try {
      const embedder = model();
      const service = createMemoryCoreService({ db, policyConfigPath: config(false), now: () => now });
      await service.storeMemory(capture("old", "Alice uses Python for backend."));
      await service.storeMemory(capture("new", "Alice now uses Rust for backend instead of Python."));
      await service.storeMemory(capture("foreign", "automobile", "other"));
      await service.storeMemory({ ...capture("expired", "automobile"), expiresAt: "2025-01-01T00:00:00.000Z" });
      const visible = await searchSemanticMemories(db, "p", "car", now, false, embedder);
      expect(visible.map(r => r.candidate.id)).toEqual(["new"]);
      expect((await searchSemanticMemories(db, "p", "car", now, true, embedder)).map(r => r.candidate.id).sort()).toEqual(["new", "old"]);
    } finally { db.close(); }
  });

  it("invalidates edited and deleted vectors, backfills summaries/imports, and separates models", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, policyConfigPath: config(false), now: () => now });
      await service.storeMemory(capture("m", "automobile"));
      const embedder = model();
      await indexSemanticMemories(db, "p", embedder);
      await indexSemanticMemories(db, "p", embedder);
      expect(embedder.embed).toHaveBeenCalledTimes(1);
      await indexSemanticMemories(db, "p", model("v2"));
      expect(db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get()).toEqual({ n: 2 });
      db.prepare("UPDATE memories SET content = 'lunch' WHERE id = 'm'").run();
      expect(db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get()).toEqual({ n: 0 });
      await service.summarizeSessionToMemory({ projectId: "p", sessionId: "summary", memoryId: "summary", sourceAdapter: "test", summary: "automobile", importance: 5 });
      await indexSemanticMemories(db, "p", embedder);
      expect(db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get()).toEqual({ n: 2 });
      db.prepare("DELETE FROM memories").run();
      expect(db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it("embeds only stored redacted text and rejects vectors computed during a concurrent edit", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, policyConfigPath: config(false), now: () => now });
      await service.storeMemory(capture("m", "api_key=sk-test-secret-1234567890"));
      const embedder = model();
      await indexSemanticMemories(db, "p", embedder);
      const stored = db.prepare("SELECT content FROM memories WHERE id = 'm'").get() as { content: string };
      expect(embedder.embed).toHaveBeenCalledWith(stored.content);
      expect(stored.content).not.toContain("sk-test-secret-1234567890");
      db.prepare("DELETE FROM semantic_embeddings").run();
      embedder.embed = async () => { db.prepare("UPDATE memories SET content = 'edited' WHERE id = 'm'").run(); return [1, 0]; };
      await indexSemanticMemories(db, "p", embedder);
      expect(db.prepare("SELECT count(*) AS n FROM semantic_embeddings").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it.each([null, { id: "broken", dimension: 2, embed: async () => { throw new Error("unavailable"); } }])(
    "preserves BM25 results and successful capture when inference is unavailable: %s", async embedder => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const db = openDb();
      try {
        const lexical = createMemoryCoreService({ db, policyConfigPath: config(false), now: () => now });
        const fallback = createMemoryCoreService({ db, policyConfigPath: config(true), semanticEmbedder: embedder, now: () => now });
        expect((await fallback.storeMemory(capture("m", "Repair automobile engine"))).ok).toBe(true);
        const request = { projectId: "p", query: "automobile", mode: "on-demand" as const };
        expect(await fallback.retrieveMemories(request)).toEqual(await lexical.retrieveMemories(request));
      } finally { db.close(); }
    });
});
