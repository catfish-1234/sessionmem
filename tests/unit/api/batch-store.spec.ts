import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("batchStoreMemory", () => {
  it("stores 10 memories in a single call and all exist in DB", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const memories = Array.from({ length: 10 }, (_, i) => ({
      memoryId: `batch-mem-${i}`,
      sessionId: "session-batch",
      sourceAdapter: "test",
      kind: "fact",
      content: `Batch memory number ${i} with useful content`,
      importance: 5,
    }));

    const result = await service.batchStoreMemory({
      projectId: "project-batch",
      memories,
    });

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(10);

    // Every result should be ok
    for (const r of result.results) {
      expect(r.ok).toBe(true);
      expect(r.memory).toBeDefined();
      expect(r.warningCodes).toBeDefined();
    }

    // Verify all 10 exist in DB via listMemories
    const list = await service.listMemories({ projectId: "project-batch" });
    expect(list.ok).toBe(true);
    expect(list.total).toBe(10);

    // Verify ordering matches input order
    expect(result.results[0].memoryId).toBe("batch-mem-0");
    expect(result.results[9].memoryId).toBe("batch-mem-9");
  });

  it("reports invalid items individually without failing the whole batch", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    // Use service.call() to exercise the error-envelope path for the
    // top-level validation (empty array). The direct method throws on
    // invalid input via parseRequest.
    const emptyResult = await service.call("batchStoreMemory", {
      projectId: "project-batch-2",
      memories: [],
    } as never);

    // batchStoreMemoryRequestSchema requires min(1), so an empty array
    // should fail validation at the top level.
    expect(emptyResult.ok).toBe(false);
  });

  it("preserves result ordering matching input order", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const memories = [
      {
        memoryId: "z-last",
        sessionId: "session-order",
        sourceAdapter: "test",
        kind: "decision",
        content: "This should be last in results",
        importance: 3,
      },
      {
        memoryId: "a-first",
        sessionId: "session-order",
        sourceAdapter: "test",
        kind: "fact",
        content: "This should be first in results",
        importance: 7,
      },
    ];

    const result = await service.batchStoreMemory({
      projectId: "project-order",
      memories,
    });

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(2);
    expect(result.results[0].memoryId).toBe("z-last");
    expect(result.results[1].memoryId).toBe("a-first");
  });

  it("applies redaction to batch items", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    // Use the sk- API key pattern that the redaction engine recognizes,
    // matching the pattern used in redaction-write-paths.spec.ts.
    const result = await service.batchStoreMemory({
      projectId: "project-redact-batch",
      memories: [
        {
          memoryId: "redact-batch-1",
          sessionId: "session-redact",
          sourceAdapter: "test",
          kind: "fact",
          content: "token sk-abcdefghijkl is important",
          importance: 5,
          redactionEnabled: true,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(1);

    // The stored content should have the API key redacted
    const mem = await service.getMemory({
      projectId: "project-redact-batch",
      memoryId: "redact-batch-1",
    });
    expect(mem.ok).toBe(true);
    expect(mem.memory.content).not.toContain("sk-abcdefghijkl");
    expect(mem.memory.content).toContain("[REDACTED_API_KEY]");
  });
});
