import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("manual summary when autoSummarize=false", () => {
  it("autoSummarize=false returns skipped_disabled while manual summarize works", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const autoResult = await service.handleSessionEnd({
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      config: {
        autoSummarize: false,
      },
    });

    expect(autoResult.ok).toBe(true);
    expect(autoResult.status).toBe("skipped_disabled");

    const manualResult = await service.summarizeSessionToMemory({
      memoryId: "memory-1",
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      summary: "Manual summary",
      importance: 7,
    });

    expect(manualResult.ok).toBe(true);
    expect(manualResult.memoryId).toBe("memory-1");

    db.close();
  });
});
