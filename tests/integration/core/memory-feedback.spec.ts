import { describe, expect, it } from "vitest";

import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("memory feedback", () => {
  it("records auto-use feedback and caps importance at 9", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory({
      memoryId: "mem-feedback-1",
      projectId: "project-feedback",
      sessionId: "session-feedback",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Prefer concise implementation notes",
      importance: 9,
    });

    const result = await service.recordMemoryUsed({
      projectId: "project-feedback",
      memoryId: "mem-feedback-1",
      usedAt: "2026-06-03T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.previousImportance).toBe(9);
    expect(result.newImportance).toBe(9);

    const memory = db
      .prepare("SELECT importance, updated_at FROM memories WHERE id = ?")
      .get("mem-feedback-1") as { importance: number; updated_at: string };
    expect(memory.importance).toBe(9);
    expect(memory.updated_at).toBe("2026-06-03T12:00:00.000Z");

    const feedback = db
      .prepare(
        `
        SELECT memory_id, feedback_type, previous_importance, new_importance, created_at
        FROM memory_feedback
        WHERE memory_id = ?
      `,
      )
      .get("mem-feedback-1") as {
      memory_id: string;
      feedback_type: string;
      previous_importance: number;
      new_importance: number;
      created_at: string;
    };

    expect(feedback).toEqual({
      memory_id: "mem-feedback-1",
      feedback_type: "auto_use",
      previous_importance: 9,
      new_importance: 9,
      created_at: "2026-06-03T12:00:00.000Z",
    });

    db.close();
  });
});
