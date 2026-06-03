import { describe, expect, it } from "vitest";

import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("retrieveMemories on-demand mode", () => {
  it("uses deep mode to widen retrieval depth", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    for (let index = 0; index < 3; index += 1) {
      await service.storeMemory({
        memoryId: `mem-deep-${index}`,
        projectId: "project-deep",
        sessionId: `session-${index}`,
        sourceAdapter: "codex",
        kind: "fact",
        content: `deep retrieval memory ${index}`,
        importance: 5,
      });
    }

    const result = await service.retrieveMemories({
      projectId: "project-deep",
      query: "deep retrieval",
      limit: 1,
      mode: "on-demand",
      depth: "deep",
    });

    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);

    db.close();
  });
});
