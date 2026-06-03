import { describe, expect, it } from "vitest";

import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("retrieveMemories score metadata", () => {
  it("includes semantic similarity and score breakdown in retrieved DTOs", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory({
      memoryId: "mem-score-1",
      projectId: "project-score",
      sessionId: "session-score",
      sourceAdapter: "codex",
      kind: "fact",
      content: "retrieval metadata includes score",
      importance: 8,
    });

    const result = await service.retrieveMemories({
      projectId: "project-score",
      query: "retrieval metadata",
      limit: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.memories[0]?.semantic).toEqual(expect.any(Number));
    expect(result.memories[0]?.score.total).toEqual(expect.any(Number));
    expect(result.memories[0]?.score.raw).toEqual({
      semantic: expect.any(Number),
      recency: expect.any(Number),
      importance: expect.any(Number),
    });

    db.close();
  });
});
