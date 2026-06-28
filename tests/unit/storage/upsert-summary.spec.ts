import { describe, expect, it } from "vitest";
import {
  getMemoryRecordById,
  upsertSessionSummaryMemory,
} from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("upsertSessionSummaryMemory ON CONFLICT(id)", () => {
  function baseInput(overrides: {
    id: string;
    sessionId: string;
  }) {
    return {
      id: overrides.id,
      project_id: "proj-summary",
      session_id: overrides.sessionId,
      source_adapter: "test",
      kind: "summary",
      content: "session summary text",
      normalized_content: "session summary text",
      importance: 7,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      author: "alice",
      origin_project_id: null,
    };
  }

  it("re-upserting the same memoryId with a different session does not throw and updates in place", () => {
    const db = openDb();

    // First upsert: id 'test-summary-1' for session-a.
    upsertSessionSummaryMemory(db, baseInput({ id: "test-summary-1", sessionId: "session-a" }));

    // Second upsert: SAME id, DIFFERENT session. The second ON CONFLICT(id)
    // clause must catch the primary-key collision and update in place rather
    // than throwing a UNIQUE constraint failure.
    expect(() =>
      upsertSessionSummaryMemory(
        db,
        baseInput({ id: "test-summary-1", sessionId: "session-b" }),
      ),
    ).not.toThrow();

    // Exactly one row with that id survives, now pointing at session-b.
    const rows = db
      .prepare("SELECT id, session_id FROM memories WHERE id = 'test-summary-1'")
      .all() as Array<{ id: string; session_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe("session-b");

    const stored = getMemoryRecordById(db, "proj-summary", "test-summary-1");
    expect(stored?.id).toBe("test-summary-1");

    db.close();
  });
});
