import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

/**
 * batchStoreMemory refuses a row for two different reasons, and the caller fixes them
 * differently: the ID is already taken, or the session already has its one summary. Both used
 * to come back as "duplicate id", which sent an agent hunting for an ID collision that did not
 * exist when it had only written a second summary for the session.
 */
const PROJECT_ID = "project-batch-conflicts";
const item = (memoryId: string, kind: string, sessionId = "s1") => ({
  memoryId, sessionId, sourceAdapter: "claude-code", kind, content: `content of ${memoryId}`, importance: 7,
});

describe("batchStoreMemory conflict reasons", () => {
  it("says a session already has its summary when a second one arrives", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    const result = await service.call("batchStoreMemory", {
      projectId: PROJECT_ID,
      memories: [item("summary-1", "summary"), item("summary-2", "summary"), item("summary-3", "summary", "s2")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.results.map((r) => [r.memoryId, r]));
    expect(byId.get("summary-1")?.ok).toBe(true);
    expect(byId.get("summary-3")?.ok).toBe(true);
    expect(byId.get("summary-2")).toMatchObject({ ok: false });
    expect(byId.get("summary-2")?.error).toContain("already has a summary");
    db.close();
  });

  it("still says duplicate id when the ID is taken", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    await service.call("batchStoreMemory", { projectId: PROJECT_ID, memories: [item("fact-1", "fact")] });
    const result = await service.call("batchStoreMemory", { projectId: PROJECT_ID, memories: [item("fact-1", "fact")] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results[0]).toMatchObject({ memoryId: "fact-1", ok: false, error: "duplicate id" });
    db.close();
  });
});
