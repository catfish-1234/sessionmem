import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { memoryIndexResponseSchema } from "../../../src/core/api/contracts.js";

const now = new Date("2026-03-03T00:00:00Z");
let db: ReturnType<typeof openDb>;
let service: ReturnType<typeof createMemoryCoreService>;
function add(id: string, date: string, project = "p", expires?: string) {
  const content = `Project atlas deployment ${id}.\n` + "Details about deployment. ".repeat(130);
  insertMemory(db, { id, project_id: project, session_id: id, source_adapter: "test", kind: "fact", content,
    normalized_content: content.toLowerCase(), importance: 5, created_at: date, updated_at: date, expires_at: expires });
}
beforeEach(() => {
  db = openDb();
  service = createMemoryCoreService({ db, policyConfigPath: "/nonexistent/config.json", now: () => now });
  for (let i = 0; i < 15; i++) add(`m${String(i).padStart(2, "0")}`, "2026-02-01T00:00:00.000Z");
  add("foreign", "2026-02-01T00:00:00.000Z", "other");
  add("expired", "2026-02-01T00:00:00.000Z", "p", "2026-02-02T00:00:00.000Z");
});
afterEach(() => db.close());

describe("progressive disclosure service", () => {
  it("returns bounded previews with the same ordering as retrieval and no counter changes", async () => {
    const index = await service.searchMemoryIndex({ projectId: "p", query: "atlas deployment" });
    expect(memoryIndexResponseSchema.safeParse(index).success).toBe(true);
    expect(index.memories).toHaveLength(10);
    expect(index.hasMore).toBe(true);
    expect(index.memories[0]).toEqual(expect.objectContaining({ id: "m00", kind: "fact", date: "2026-02-01T00:00:00.000Z", score: expect.any(Number) }));
    for (const memory of index.memories) {
      expect(Object.keys(memory).sort()).toEqual(["date", "id", "kind", "score", "summary"]);
      expect(memory.summary.length).toBeLessThanOrEqual(160);
      expect(memory.summary).not.toMatch(/\s{2}|\n/);
    }
    const retrieved = await service.retrieveMemories({ projectId: "p", query: "atlas deployment", limit: 10, mode: "on-demand" });
    expect(index.memories.map(m => m.id)).toEqual(retrieved.memories.map(m => m.id));
    expect(db.prepare("SELECT SUM(access_count) AS count FROM memories").get()).toEqual({ count: 0 });
    const full = await service.getMemory({ projectId: "p", memoryId: index.memories[0].id });
    expect(full.memory.content.length).toBeGreaterThan(2000);
  });
  it("centers timeline on the exact ID with stable timestamp ties and fills at edges", async () => {
    const center = await service.memoryTimeline({ projectId: "p", memoryId: "m07", limit: 5 });
    expect(center.memories.map(m => m.id)).toEqual(["m05", "m06", "m07", "m08", "m09"]);
    expect(center.hasMore).toBe(true);
    expect(center.memories.every(m => m.score === null)).toBe(true);
    expect((await service.memoryTimeline({ projectId: "p", memoryId: "m00", limit: 3 })).memories.map(m => m.id)).toEqual(["m00", "m01", "m02"]);
    expect((await service.memoryTimeline({ projectId: "p", memoryId: "m14", limit: 3 })).memories.map(m => m.id)).toEqual(["m12", "m13", "m14"]);
    expect((await service.memoryTimeline({ projectId: "p", memoryId: "m07", limit: 1 })).memories.map(m => m.id)).toEqual(["m07"]);
    expect((await service.memoryTimeline({ projectId: "p", memoryId: "m07" })).memories).toHaveLength(10);
  });
  it("accepts inclusive UTC ranges and never reveals foreign or expired anchors", async () => {
    const range = await service.memoryTimeline({ projectId: "p", fromDate: "2026-02-01T00:00:00Z", toDate: "2026-02-01T00:00:00.000Z", limit: 50 });
    expect(range.memories).toHaveLength(15);
    expect(range.hasMore).toBe(false);
    for (const memoryId of ["foreign", "expired", "missing"]) {
      expect(await service.call("memoryTimeline", { projectId: "p", memoryId } as any)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect((await service.searchMemoryIndex({ projectId: "empty", query: "atlas" })).memories).toEqual([]);
  });
  it.each([
    {}, { memoryId: "m01", fromDate: "2026-02-01T00:00:00Z" },
    { fromDate: "2026-03-01T00:00:00Z", toDate: "2026-02-01T00:00:00Z" },
    { fromDate: "2026-02-30T00:00:00Z", toDate: "2026-03-03T00:00:00Z" },
    { memoryId: "m01", limit: 0 }, { memoryId: "m01", limit: 51 },
  ])("validates malformed timeline input: %j", async request => {
    expect(await service.call("memoryTimeline", { projectId: "p", ...request } as any)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
  it("includes superseded timeline context by default and supports an explicit override", async () => {
    for (const [id, content, date] of [["old", "I use VS Code.", "2026-01-01T00:00:00.000Z"],
      ["new", "I switched to Neovim.", "2026-01-02T00:00:00.000Z"]]) {
      insertMemory(db, { id, project_id: "p", session_id: id, source_adapter: "test", kind: "fact", content,
        normalized_content: content.toLowerCase(), importance: 5, created_at: date, updated_at: date });
    }
    expect((await service.memoryTimeline({ projectId: "p", memoryId: "old", limit: 1 })).memories[0].id).toBe("old");
    expect(await service.call("memoryTimeline", { projectId: "p", memoryId: "old", includeHistory: false } as any))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await service.searchMemoryIndex({ projectId: "p", query: "VS Code" })).memories.map(m => m.id)).not.toContain("old");
    expect((await service.searchMemoryIndex({ projectId: "p", query: "VS Code", includeHistory: true })).memories.map(m => m.id)).toContain("old");
  });
  it("rejects oversized and fractional search limits", async () => {
    for (const limit of [0, 51, 1.5]) expect(await service.call("searchMemoryIndex", { projectId: "p", query: "atlas", limit })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
});
