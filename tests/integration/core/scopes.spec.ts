import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory, updateMemoryContent } from "../../../src/core/storage/memoryRepo.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { listProjectKnowledge } from "../../../src/core/storage/knowledgeRepo.js";
import { searchSemanticMemories } from "../../../src/core/storage/semanticSearchRepo.js";

const now = new Date("2026-01-01T00:00:00.000Z");
let db: ReturnType<typeof openDb>, dir: string, config: string;
beforeEach(() => {
  db = openDb(); dir = mkdtempSync(join(tmpdir(), "sessionmem-scopes-")); config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ retentionDays: 0, semanticSearch: false }));
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
function add(id: string, scope: string | null, content = "Routine status note.", date = now.toISOString(), project = "p", expires?: string) {
  insertMemory(db, { id, project_id: project, session_id: id, source_adapter: "test", kind: "fact",
    content, normalized_content: content.toLowerCase(), importance: 5, scope, created_at: date, updated_at: date, expires_at: expires });
}
function service(extra: Partial<Parameters<typeof createMemoryCoreService>[0]> = {}) {
  return createMemoryCoreService({ db, username: "fixture", policyConfigPath: config, now: () => now, ...extra });
}
const base = { projectId: "p", query: "unrecognized zebra", mode: "on-demand" as const };

describe("scope capture and compatibility", () => {
  it("auto-detects a directory label and records session, memory and extracted entity scopes", async () => {
    const api = service({ workingDirectory: "/offline/work/atlas" });
    await api.storeMemory({ memoryId: "m", projectId: "p", sessionId: "s", sourceAdapter: "test", kind: "fact", content: "Alice uses SQLite.", importance: 5 });
    expect(db.prepare("SELECT scope FROM sessions").all()).toEqual([{ scope: "atlas" }]);
    expect(db.prepare("SELECT scope FROM memories").all()).toEqual([{ scope: "atlas" }]);
    expect(db.prepare("SELECT DISTINCT scope FROM memory_entities").all()).toEqual([{ scope: "atlas" }]);
    updateMemoryContent(db, "p", "m", "Alice uses PostgreSQL.");
    expect(db.prepare("SELECT DISTINCT scope FROM memory_entities").all()).toEqual([{ scope: "atlas" }]);
  });

  it("honors explicit labels and null, and retains session choices over capture defaults", async () => {
    writeFileSync(config, JSON.stringify({ scope: "configured" }));
    const api = service({ workingDirectory: "/offline/work/atlas" });
    const input = { projectId: "p", sessionId: "s", sourceAdapter: "test", kind: "fact", content: "Alice uses SQLite.", importance: 5 };
    await api.storeMemory({ ...input, memoryId: "a", scope: "  explicit  " });
    await api.storeMemory({ ...input, memoryId: "b" });
    await api.storeMemory({ ...input, memoryId: "c", scope: null });
    await api.storeMemory({ ...input, memoryId: "d" });
    await api.storeMemory({ ...input, memoryId: "e", sessionId: "new" });
    expect(db.prepare("SELECT id, scope FROM memories ORDER BY id").all()).toEqual([
      { id: "a", scope: "explicit" }, { id: "b", scope: "explicit" }, { id: "c", scope: null }, { id: "d", scope: null }, { id: "e", scope: "configured" },
    ]);
    expect(db.prepare("SELECT DISTINCT scope FROM memory_entities WHERE memory_id = 'a'").all()).toEqual([{ scope: "explicit" }]);
  });

  it("inherits event-session labels through automatic and explicit summary writes", async () => {
    const api = service();
    await api.ingestSessionEvents({ projectId: "p", sessionId: "s", scope: "research",
      events: [{ id: "e", eventType: "user", payloadJson: JSON.stringify({ text: "Alice uses SQLite." }) }] });
    const result = await api.handleSessionEnd({ projectId: "p", sessionId: "s", sourceAdapter: "test",
      config: { minimumEventThreshold: 1, allowCloudSummarization: false } });
    expect(result.status).toBe("stored");
    expect(db.prepare("SELECT DISTINCT scope FROM memories").all()).toEqual([{ scope: "research" }]);
    expect(db.prepare("SELECT DISTINCT scope FROM memory_entities").all()).toEqual([{ scope: "research" }]);
    await api.summarizeSessionToMemory({ projectId: "p", sessionId: "s", memoryId: "summary", sourceAdapter: "test",
      summary: "Alice uses SQLite.", importance: 5, scope: "revised" });
    expect(db.prepare("SELECT DISTINCT scope FROM memories").all()).toEqual([{ scope: "revised" }]);
  });

  it("preserves labels through batch capture and export/import, while old imports stay unlabelled", async () => {
    const api = service();
    await api.batchStoreMemory({ projectId: "p", memories: [{ memoryId: "m", sessionId: "s", sourceAdapter: "test", kind: "fact",
      content: "Alice uses SQLite.", importance: 5, scope: "batch" }] });
    const exported = await api.exportMemories({ projectId: "p" });
    expect(exported.memories[0].scope).toBe("batch");
    await api.importMemories({ projectId: "p", memories: exported.memories });
    expect(db.prepare("SELECT scope FROM memories WHERE id = 'm'").get()).toEqual({ scope: "batch" });
    const { scope: _scope, ...old } = exported.memories[0];
    await api.importMemories({ projectId: "p", memories: [{ ...old, id: "legacy" }] });
    expect(db.prepare("SELECT scope FROM memories WHERE id = 'legacy'").get()).toEqual({ scope: null });
    expect(db.prepare("SELECT scope FROM sessions WHERE project_id = 'p' AND session_id = 's'").get()).toEqual({ scope: "batch" });
  });

  it("keeps no-scope full and compact responses byte-identical to main across mixed labels and candidate limits", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/storage/scope-defaults.json", import.meta.url), "utf8"));
    const api = service();
    for (let i = 0; i < fixture.seed.count; i++) {
      const memoryId = `m${String(i).padStart(3, "0")}`;
      await api.storeMemory({ memoryId, projectId: "scope-defaults", sessionId: `s${i}`, sourceAdapter: "test", kind: "fact",
        content: i < 2 ? fixture.seed.rare_content : fixture.seed.templates[i % 3], importance: 1 + i % 10 });
      db.prepare("UPDATE memories SET scope = ? WHERE id = ?").run(i % 3 ? `label-${i % 3}` : null, memoryId);
    }
    for (const { method, request, sha256 } of fixture.hashes) {
      const result = await api.call(method, request);
      expect(createHash("sha256").update(JSON.stringify(result)).digest("hex"), `${method}: ${request.query}`).toBe(sha256);
    }
  });
});

describe("scope filtering and boosting", () => {
  it("filters lexical and fallback candidates before their limits, using exact labels and null for unlabelled", async () => {
    for (let i = 0; i < 65; i++) add(`a${i}`, "other", "Deployment status.");
    add("z", "work", "Deployment status."); add("u", null, "Deployment status."); add("c", "Work", "Deployment status.");
    const api = service();
    expect((await api.searchMemoryIndex({ projectId: "p", query: "deployment", scope: "work" })).memories.map(row => row.id)).toEqual(["z"]);
    expect((await api.retrieveMemories({ ...base, scope: "work" })).memories.map(row => row.id)).toEqual(["z"]);
    expect((await api.retrieveMemories({ ...base, scope: null })).memories.map(row => row.id)).toEqual(["u"]);
    expect((await api.retrieveMemories({ ...base, scope: "absent" })).memories).toEqual([]);
  });

  it("filters alias/entity candidates before admission even when lexical and recency scans miss them", () => {
    for (let i = 0; i < 60; i++) add(`a${i}`, "other", "PostgreSQL stores records.");
    add("z", "work", "PostgreSQL stores records.", "2025-01-01T00:00:00.000Z");
    const result = retrieveMemories({ db, projectId: "p", query: "postgres", now, scope: "work", entityLinkBoost: true, entityBoost: true });
    expect(result.map(row => row.id)).toEqual(["z"]);
    expect(listProjectKnowledge(db, "p", now, { scope: "work" }).entities[0].memoryIds).toEqual(["z"]);
  });

  it("supports the scoped index, timeline and detail flow without crossing the selected label", async () => {
    add("a", "other"); add("b", "work"); add("c", "other"); add("d", "work");
    const api = service();
    const index = await api.searchMemoryIndex({ projectId: "p", query: "status", scope: "work" });
    expect(index.memories.map(row => row.id)).toEqual(["b", "d"]);
    const timeline = await api.memoryTimeline({ projectId: "p", memoryId: "b", scope: "work" });
    expect(timeline.memories.map(row => row.id)).toEqual(["b", "d"]);
    expect((await api.getMemory({ projectId: "p", memoryId: "b", scope: "work" })).memory.id).toBe("b");
    expect(await api.call("getMemory", { projectId: "p", memoryId: "a", scope: "work" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await api.call("memoryTimeline", { projectId: "p", memoryId: "a", scope: "work" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("applies scope before local dense top-k selection", async () => {
    for (let i = 0; i < 60; i++) add(`a${i}`, "other");
    add("z", "work");
    const embedder = { id: "fixture", dimension: 2, embed: async () => [1, 0] };
    const selected = await searchSemanticMemories(db, "p", "zebra", now, false, embedder, { scope: "work" });
    expect(selected.map(row => row.candidate.id)).toEqual(["z"]);
    writeFileSync(config, JSON.stringify({ semanticSearch: true }));
    expect((await service({ semanticEmbedder: embedder }).retrieveMemories({ ...base, scope: "work" })).memories.map(row => row.id)).toEqual(["z"]);
  });

  it("boosts matching scope without excluding others, bounded alongside recency and time signals", async () => {
    add("a", "personal"); add("z", "work");
    const api = service();
    const before = await api.retrieveMemories(base);
    const after = await api.retrieveMemories({ ...base, scope: "work", scopeMode: "boost" });
    expect(after.memories.map(row => row.id)).toEqual(["z", "a"]);
    expect(after.memories[0].score.total).toBeCloseTo(before.memories.find(row => row.id === "z")!.score.total + 0.06);
    expect(after.memories.find(row => row.id === "a")).toEqual(before.memories.find(row => row.id === "a"));
    db.prepare("UPDATE memories SET updated_at = '2025-11-01T00:00:00.000Z' WHERE id = 'z'").run();
    expect((await api.retrieveMemories({ ...base, scope: "work", scopeMode: "boost" })).memories[0].id).toBe("a");
    writeFileSync(config, JSON.stringify({ temporalRetrieval: true }));
    const temporalBefore = await api.retrieveMemories({ ...base, query: "current zebra" });
    const temporalAfter = await api.retrieveMemories({ ...base, query: "current zebra", scope: "work", scopeMode: "boost" });
    expect(temporalAfter.memories[0].id).toBe("a");
    expect(temporalAfter.memories.find(row => row.id === "z")!.score.total - temporalBefore.memories.find(row => row.id === "z")!.score.total).toBeCloseTo(0.054);
  });

  it("preserves project, expiry and history visibility", async () => {
    add("foreign", "work", "Status note.", now.toISOString(), "foreign");
    add("expired", "work", "Status note.", now.toISOString(), "p", "2025-12-01T00:00:00.000Z");
    add("old", "work", "I use VS Code.", "2025-11-01T00:00:00.000Z");
    add("new", "work", "I switched to Neovim.", "2025-12-01T00:00:00.000Z");
    const api = service();
    expect((await api.retrieveMemories({ ...base, query: "VS Code", scope: "work" })).memories.map(row => row.id)).toEqual(["new"]);
    expect((await api.retrieveMemories({ ...base, query: "VS Code", scope: "work", includeHistory: true })).memories.map(row => row.id)).toContain("old");
  });

  it.each([{ scope: "" }, { scope: "x".repeat(161) }, { scope: "bad\nlabel" }, { scopeMode: "boost" }, { scope: "work", scopeMode: "invalid" }])("rejects malformed scope input: %j", async input => {
    expect(await service().call("retrieveMemories", { ...base, ...input } as any)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
});
