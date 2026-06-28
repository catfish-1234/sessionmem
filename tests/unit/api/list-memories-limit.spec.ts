import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { LIST_MEMORIES_DEFAULT_LIMIT } from "../../../src/core/api/contracts.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("listMemories limit", () => {
  async function seed(count: number) {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    const memories = Array.from({ length: count }, (_, i) => ({
      memoryId: `mem-${String(i).padStart(4, "0")}`,
      sessionId: "session-list",
      sourceAdapter: "test",
      kind: "fact",
      content: `Memory number ${i}`,
      importance: 5,
    }));
    // Store in chunks so counts above the batch-size cap can be seeded.
    for (let i = 0; i < memories.length; i += 50) {
      await service.batchStoreMemory({
        projectId: "proj-list",
        memories: memories.slice(i, i + 50),
      });
    }
    return service;
  }

  it("caps the returned array at the default limit while total reports the full count", async () => {
    const overflow = LIST_MEMORIES_DEFAULT_LIMIT + 50;
    const service = await seed(overflow);
    const list = await service.listMemories({ projectId: "proj-list" });
    expect(list.ok).toBe(true);
    expect(list.total).toBe(overflow);
    expect(list.memories).toHaveLength(LIST_MEMORIES_DEFAULT_LIMIT);
  });

  it("honors an explicit limit smaller than the row count", async () => {
    const service = await seed(50);
    const list = await service.listMemories({ projectId: "proj-list", limit: 10 });
    expect(list.total).toBe(50);
    expect(list.memories).toHaveLength(10);
  });

  it("returns every row when the count is below the default limit", async () => {
    const service = await seed(5);
    const list = await service.listMemories({ projectId: "proj-list" });
    expect(list.total).toBe(5);
    expect(list.memories).toHaveLength(5);
  });

  it("rejects a non-positive or oversized limit", async () => {
    const service = await seed(1);
    await expect(
      service.listMemories({ projectId: "proj-list", limit: 0 }),
    ).rejects.toThrow();
    await expect(
      service.listMemories({ projectId: "proj-list", limit: 5000 }),
    ).rejects.toThrow();
  });
});
