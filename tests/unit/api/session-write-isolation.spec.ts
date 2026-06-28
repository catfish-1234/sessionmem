import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { countMemoriesBySession } from "../../../src/core/storage/memoryRepo.js";
import { SESSION_WRITE_SOFT_LIMIT } from "../../../src/core/config/policyConfig.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("countMemoriesBySession project isolation (FIX-03)", () => {
  it("counts are scoped per project even when the sessionId is shared", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const sessionId = "shared-session-id";

    // Two different projects reuse the SAME sessionId.
    await service.storeMemory({
      memoryId: "a-1",
      projectId: "project-A",
      sessionId,
      sourceAdapter: "test",
      kind: "fact",
      content: "project A memory one",
      importance: 5,
    });
    await service.storeMemory({
      memoryId: "b-1",
      projectId: "project-B",
      sessionId,
      sourceAdapter: "test",
      kind: "fact",
      content: "project B memory one",
      importance: 5,
    });
    await service.storeMemory({
      memoryId: "b-2",
      projectId: "project-B",
      sessionId,
      sourceAdapter: "test",
      kind: "fact",
      content: "project B memory two",
      importance: 5,
    });

    // The AND project_id = ? clause must isolate the counts.
    expect(countMemoriesBySession(db, sessionId, "project-A")).toBe(1);
    expect(countMemoriesBySession(db, sessionId, "project-B")).toBe(2);

    db.close();
  });
});

describe("batchStoreMemory session write limit warning (FIX-04)", () => {
  it(`emits session_write_limit_warning for a session already at the soft limit`, async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const projectId = "proj-batch-limit";
    const sessionId = "session-batch-limit";

    // Pre-fill the session to the soft limit.
    for (let i = 0; i < SESSION_WRITE_SOFT_LIMIT; i++) {
      await service.storeMemory({
        memoryId: `pre-${i}`,
        projectId,
        sessionId,
        sourceAdapter: "test",
        kind: "fact",
        content: `pre-fill memory ${i}`,
        importance: 5,
      });
    }

    // A batch into the same session should now carry the warning per item.
    const result = await service.batchStoreMemory({
      projectId,
      memories: [
        {
          memoryId: "batch-over-1",
          sessionId,
          sourceAdapter: "test",
          kind: "fact",
          content: "one over the limit via batch",
          importance: 5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(1);
    expect(result.results[0].warningCodes).toContain(
      "session_write_limit_warning",
    );

    db.close();
  });

  it("does NOT warn for a fresh session in another project with the same sessionId", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const sessionId = "session-cross-project";

    // Fill project-X to the limit.
    for (let i = 0; i < SESSION_WRITE_SOFT_LIMIT; i++) {
      await service.storeMemory({
        memoryId: `x-${i}`,
        projectId: "project-X",
        sessionId,
        sourceAdapter: "test",
        kind: "fact",
        content: `x memory ${i}`,
        importance: 5,
      });
    }

    // The same sessionId in project-Y is fresh → no warning.
    const result = await service.batchStoreMemory({
      projectId: "project-Y",
      memories: [
        {
          memoryId: "y-1",
          sessionId,
          sourceAdapter: "test",
          kind: "fact",
          content: "first memory in project Y",
          importance: 5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].warningCodes).not.toContain(
      "session_write_limit_warning",
    );

    db.close();
  });
});
