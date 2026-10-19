import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { searchMemoryCandidatesByIds } from "../../../src/core/storage/memorySearchRepo.js";

const now = new Date("2026-03-03T00:00:00Z");
const dbs: ReturnType<typeof openDb>[] = [];
const dirs: string[] = [];
afterEach(() => { dbs.forEach(db => db.close()); dbs.length = 0; dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); dirs.length = 0; });
function fixture() {
  const db = openDb(); dbs.push(db);
  function add(id: string, content: string, date: string, project = "p", expires?: string) {
    insertMemory(db, { id, content, normalized_content: content.toLowerCase(), project_id: project, session_id: id,
      source_adapter: "test", kind: "fact", importance: 5, created_at: date, updated_at: date, expires_at: expires });
  }
  add("old", "Alice uses SQLite.", "2026-01-01T00:00:00.000Z");
  add("new", "Alice now uses PostgreSQL instead of SQLite.", "2026-02-10T00:00:00.000Z");
  return { db, add };
}
describe("temporal retrieval", () => {
  it("includes superseded history for past cues and honors an explicit false", () => {
    const { db } = fixture();
    const request = { db, projectId: "p", query: "What did Alice use before?", now };
    expect(retrieveMemories(request).map(m => m.id)).not.toContain("old");
    expect(retrieveMemories({ ...request, temporalRetrieval: true }).map(m => m.id)).toContain("old");
    expect(retrieveMemories({ ...request, temporalRetrieval: true, includeHistory: false }).map(m => m.id)).not.toContain("old");
  });
  it("does not change uncued queries even when enabled", () => {
    const { db } = fixture();
    const request = { db, projectId: "p", query: "Alice database", now };
    expect(retrieveMemories({ ...request, temporalRetrieval: true })).toEqual(retrieveMemories(request));
  });
  it("prefers latest facts for current state and observation dates for past events", () => {
    const { db, add } = fixture();
    add("dated", "Project atlas deployment completed.", "2026-02-15T00:00:00.000Z");
    add("recent", "Project atlas deployment completed.", "2026-03-02T00:00:00.000Z");
    const request = { db, projectId: "p", now, temporalRetrieval: true, limit: 1 };
    expect(retrieveMemories({ ...request, query: "current atlas deployment" })[0].id).toBe("recent");
    expect(retrieveMemories({ ...request, query: "atlas deployment last month" })[0].id).toBe("dated");
  });
  it("keeps expired and cross-project history out of both lexical and semantic paths", async () => {
    const { db, add } = fixture();
    add("expired", "Alice uses SQLite.", "2026-01-01T00:00:00.000Z", "p", "2026-02-01T00:00:00.000Z");
    add("foreign", "Alice uses SQLite.", "2026-01-01T00:00:00.000Z", "other");
    const dir = mkdtempSync(join(tmpdir(), "temporal-test-")); dirs.push(dir);
    const config = join(dir, "config.json");
    writeFileSync(config, JSON.stringify({ temporalRetrieval: true, semanticSearch: true }));
    // Dense-only evidence uses the same inferred history visibility.
    const old = searchMemoryCandidatesByIds(db, "p", ["old"], now, true)[0];
    expect(old).toBeDefined();
    const service = createMemoryCoreService({ db, policyConfigPath: config, now: () => now,
      semanticEmbedder: { id: "test", dimension: 2, embed: async () => [1, 0] } });
    const result = await service.retrieveMemories({ projectId: "p", query: "What did Alice use before?", mode: "on-demand" });
    expect(result.memories.map(m => m.id)).toContain("old");
    expect(result.memories.map(m => m.id)).not.toContain("expired");
    expect(result.memories.map(m => m.id)).not.toContain("foreign");
    const restricted = await service.retrieveMemories({ projectId: "p", query: "What did Alice use before?", includeHistory: false });
    expect(restricted.memories.map(m => m.id)).not.toContain("old");
    expect((await service.searchMemoryIndex({ projectId: "p", query: "What did Alice use before?" })).memories.map(m => m.id)).toContain("old");
  });
});
