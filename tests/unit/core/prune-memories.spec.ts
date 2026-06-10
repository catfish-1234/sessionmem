import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countMemoriesOlderThan,
  deleteMemoriesOlderThan,
  insertMemory,
  listMemoriesByProject,
} from "../../../src/core/storage/memoryRepo.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

const PROJECT_ID = "project-prune";

function seedMemory(
  db: ReturnType<typeof openDb>,
  id: string,
  createdAt: string,
): void {
  insertMemory(db, {
    id,
    project_id: PROJECT_ID,
    session_id: "session-1",
    source_adapter: "codex",
    kind: "fact",
    content: `content-${id}`,
    normalized_content: `content ${id}`,
    importance: 5,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

describe("retention prune repo functions", () => {
  it("counts memories older than cutoff without deleting", () => {
    const db = openDb();
    seedMemory(db, "old", "2020-01-01T00:00:00.000Z");
    seedMemory(db, "new", "2099-01-01T00:00:00.000Z");

    const eligible = countMemoriesOlderThan(
      db,
      PROJECT_ID,
      "2050-01-01T00:00:00.000Z",
    );

    expect(eligible).toBe(1);
    expect(listMemoriesByProject(db, PROJECT_ID)).toHaveLength(2);

    db.close();
  });

  it("deletes only memories older than cutoff and returns the count", () => {
    const db = openDb();
    seedMemory(db, "old", "2020-01-01T00:00:00.000Z");
    seedMemory(db, "new", "2099-01-01T00:00:00.000Z");

    const deleted = deleteMemoriesOlderThan(
      db,
      PROJECT_ID,
      "2050-01-01T00:00:00.000Z",
    );

    expect(deleted).toBe(1);
    expect(
      countMemoriesOlderThan(db, PROJECT_ID, "2050-01-01T00:00:00.000Z"),
    ).toBe(0);

    const survivors = listMemoriesByProject(db, PROJECT_ID);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe("new");

    db.close();
  });

  it("returns 0 and deletes nothing when cutoff predates all rows", () => {
    const db = openDb();
    seedMemory(db, "old", "2020-01-01T00:00:00.000Z");
    seedMemory(db, "new", "2099-01-01T00:00:00.000Z");

    expect(
      countMemoriesOlderThan(db, PROJECT_ID, "1999-01-01T00:00:00.000Z"),
    ).toBe(0);
    expect(
      deleteMemoriesOlderThan(db, PROJECT_ID, "1999-01-01T00:00:00.000Z"),
    ).toBe(0);
    expect(listMemoriesByProject(db, PROJECT_ID)).toHaveLength(2);

    db.close();
  });

  it("does not remove session_events rows when pruning memories", () => {
    const db = openDb();
    seedMemory(db, "old", "2020-01-01T00:00:00.000Z");
    insertSessionEvent(db, {
      id: "evt-1",
      project_id: PROJECT_ID,
      session_id: "session-1",
      event_index: 0,
      event_type: "user_message",
      payload_json: "{\"text\":\"hi\"}",
      created_at: "2020-01-01T00:00:00.000Z",
    });

    deleteMemoriesOlderThan(db, PROJECT_ID, "2050-01-01T00:00:00.000Z");

    const remainingEvents = db
      .prepare("SELECT COUNT(*) AS count FROM session_events WHERE project_id = ?")
      .get(PROJECT_ID) as { count: number };
    expect(remainingEvents.count).toBe(1);

    db.close();
  });

  it("binds parameters instead of interpolating projectId/cutoff", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../src/core/storage/memoryRepo.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(source).toContain("countMemoriesOlderThan");
    expect(source).toContain("deleteMemoriesOlderThan");
    // SQL filters use ? placeholders, never template-literal interpolation
    expect(source).not.toMatch(/created_at < \$\{/);
    expect(source).not.toMatch(/project_id = \$\{/);
  });
});
