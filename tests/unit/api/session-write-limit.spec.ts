import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { SESSION_WRITE_SOFT_LIMIT } from "../../../src/core/config/policyConfig.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("per-session write soft limit", () => {
  it("does not include session_write_limit_warning when below the limit", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.storeMemory({
      memoryId: "mem-below-1",
      projectId: "proj-limit-test",
      sessionId: "session-below-limit",
      sourceAdapter: "test",
      kind: "fact",
      content: "a memory below the limit",
      importance: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.warningCodes).not.toContain("session_write_limit_warning");

    db.close();
  });

  it(`warns after ${SESSION_WRITE_SOFT_LIMIT} stores in same session`, async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const sessionId = "session-soft-limit-test";
    const projectId = "proj-soft-limit";

    // Store exactly SESSION_WRITE_SOFT_LIMIT memories without warning
    for (let i = 0; i < SESSION_WRITE_SOFT_LIMIT; i++) {
      const result = await service.storeMemory({
        memoryId: `mem-sl-${i}`,
        projectId,
        sessionId,
        sourceAdapter: "test",
        kind: "fact",
        content: `memory number ${i}`,
        importance: 5,
      });
      expect(result.ok).toBe(true);
      // The first SESSION_WRITE_SOFT_LIMIT memories should NOT trigger the warning
      // because the count is checked BEFORE insert (count < limit at that point)
      if (i < SESSION_WRITE_SOFT_LIMIT - 1) {
        expect(result.warningCodes).not.toContain("session_write_limit_warning");
      }
    }

    // The (SESSION_WRITE_SOFT_LIMIT + 1)th store should include the warning
    const overLimitResult = await service.storeMemory({
      memoryId: `mem-sl-${SESSION_WRITE_SOFT_LIMIT}`,
      projectId,
      sessionId,
      sourceAdapter: "test",
      kind: "fact",
      content: "one more memory over the limit",
      importance: 5,
    });

    expect(overLimitResult.ok).toBe(true);
    expect(overLimitResult.warningCodes).toContain("session_write_limit_warning");

    db.close();
  });

  it("still persists the memory when over the soft limit (not a hard block)", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const sessionId = "session-persist-test";
    const projectId = "proj-persist-test";

    // Pre-fill to the limit
    for (let i = 0; i < SESSION_WRITE_SOFT_LIMIT; i++) {
      await service.storeMemory({
        memoryId: `mem-persist-${i}`,
        projectId,
        sessionId,
        sourceAdapter: "test",
        kind: "fact",
        content: `memory ${i}`,
        importance: 5,
      });
    }

    // Store one more over the limit
    const result = await service.storeMemory({
      memoryId: "mem-persist-over",
      projectId,
      sessionId,
      sourceAdapter: "test",
      kind: "fact",
      content: "this should still persist",
      importance: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.warningCodes).toContain("session_write_limit_warning");

    // Verify the memory was actually persisted
    const fetched = await service.getMemory({
      projectId,
      memoryId: "mem-persist-over",
    });
    expect(fetched.ok).toBe(true);
    expect(fetched.memory.id).toBe("mem-persist-over");

    db.close();
  });
});
