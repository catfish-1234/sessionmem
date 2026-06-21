import { describe, it, expect } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import type { Database } from "better-sqlite3";

function queryFeedbackRows(db: Database, memoryId: string) {
  return db
    .prepare(
      "SELECT memory_id, feedback_type, previous_importance, new_importance FROM memory_feedback WHERE memory_id = ?",
    )
    .all(memoryId) as Array<{
    memory_id: string;
    feedback_type: string;
    previous_importance: number;
    new_importance: number;
  }>;
}

describe("forgetMemory feedback recording", () => {
  it("inserts a manual_delete feedback row when a memory is forgotten", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    const projectId = "proj-feedback";
    const memoryId = "mem-to-forget";

    // Store a memory with known importance
    await service.storeMemory({
      memoryId,
      projectId,
      sessionId: "sess-1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Some fact to forget",
      importance: 7,
    });

    // Forget it
    const result = await service.forgetMemory({ projectId, memoryId });
    expect(result.ok).toBe(true);

    // Verify the feedback row exists
    const rows = queryFeedbackRows(db, memoryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback_type).toBe("manual_delete");
    expect(rows[0].previous_importance).toBe(7);
    expect(rows[0].new_importance).toBe(0);

    db.close();
  });

  it("captures correct importance when memory has non-default importance", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    const projectId = "proj-feedback-2";
    const memoryId = "mem-high-importance";

    await service.storeMemory({
      memoryId,
      projectId,
      sessionId: "sess-1",
      sourceAdapter: "codex",
      kind: "decision",
      content: "Critical architectural decision",
      importance: 10,
    });

    await service.forgetMemory({ projectId, memoryId });

    const rows = queryFeedbackRows(db, memoryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].previous_importance).toBe(10);
    expect(rows[0].new_importance).toBe(0);

    db.close();
  });

  it("feedback row survives after the memory itself is deleted", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    const projectId = "proj-feedback-3";
    const memoryId = "mem-survive-check";

    await service.storeMemory({
      memoryId,
      projectId,
      sessionId: "sess-1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Will be deleted",
      importance: 5,
    });

    await service.forgetMemory({ projectId, memoryId });

    // Memory should be gone (getMemory throws DomainError for NOT_FOUND,
    // so use the call() wrapper which catches and returns { ok: false })
    const memResult = await service.call("getMemory", { projectId, memoryId });
    expect(memResult.ok).toBe(false);

    // But feedback row should still exist
    const rows = queryFeedbackRows(db, memoryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback_type).toBe("manual_delete");

    db.close();
  });
});
