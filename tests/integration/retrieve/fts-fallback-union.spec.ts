import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

/**
 * HIGH-1 regression guard: when FTS5 returns fewer than the fallback threshold
 * (5) matches, those matches must be UNIONed with the recency/importance
 * fallback scan — never replaced by it. Old/low-importance rows that match the
 * query but fall outside the fallback filter (updated_at <= now-90d AND
 * importance < 8) were previously dropped, returning zero results.
 */
describe("FTS fallback unions matches instead of replacing them", () => {
  it("returns old, low-importance memories that match the query", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const projectId = "proj-fts-fallback";
    const ids = ["old-1", "old-2", "old-3"];

    for (const id of ids) {
      await service.storeMemory({
        memoryId: id,
        projectId,
        sessionId: "s-fts",
        sourceAdapter: "test",
        kind: "fact",
        // Distinctive token so FTS matches exactly these rows (< 5 hits).
        content: `zorptoken marker content for ${id}`,
        importance: 3, // below the importance>=8 fallback floor
      });
    }

    // Age the rows well past the 90-day fallback window so the
    // recency/importance fallback scan would EXCLUDE them.
    db.prepare(
      "UPDATE memories SET updated_at = ?, created_at = ? WHERE project_id = ?",
    ).run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", projectId);

    const result = await service.retrieveMemories({
      projectId,
      query: "zorptoken",
      limit: 20,
      mode: "auto",
      depth: "default",
    });

    expect(result.ok).toBe(true);
    const returnedIds = result.memories.map((m) => m.id).sort();
    expect(returnedIds).toEqual(ids);

    db.close();
  });
});
