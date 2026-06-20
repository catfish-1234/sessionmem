import { describe, expect, it } from "vitest";

import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import {
  computeEffectiveImportance,
  ACCESS_BOOST_THRESHOLD,
} from "../../../src/core/retrieve/score.js";
import {
  incrementAccessCounts,
  insertMemory,
  resetAccessCounts,
} from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

function seedMemory(
  db: ReturnType<typeof openDb>,
  id: string,
  projectId: string,
  importance: number,
  queryText: string,
  updatedAt: string,
) {
  const embedding = deterministicEmbed(queryText, 8);
  insertMemory(db, {
    id,
    project_id: projectId,
    session_id: "session-1",
    source_adapter: "test",
    kind: "fact",
    content: `memory ${id}`,
    normalized_content: embedding.normalizedText,
    importance,
    embedding: JSON.stringify(embedding.vector),
    embedding_dim: embedding.dimension,
    embedding_version: embedding.embeddingVersion,
    updated_at: updatedAt,
  });
}

describe("access-pattern boosting", () => {
  it("(a) boosted memory scored 3 ranks above never-accessed memory scored 4", () => {
    const db = openDb();
    const now = new Date("2026-06-19T12:00:00.000Z");
    const query = "access boost test query";
    const updatedAt = "2026-06-19T11:00:00.000Z";

    seedMemory(db, "mem-low-importance", "proj-1", 3, query, updatedAt);
    seedMemory(db, "mem-high-importance", "proj-1", 4, query, updatedAt);

    // Simulate crossing access threshold for the low-importance memory
    db.prepare(
      "UPDATE memories SET access_count = ? WHERE id = ?",
    ).run(ACCESS_BOOST_THRESHOLD, "mem-low-importance");

    const results = retrieveMemories({
      db,
      projectId: "proj-1",
      queryText: query,
      topK: 2,
      now,
    });

    // effective_importance of mem-low-importance = min(3+2, 10) = 5
    // effective_importance of mem-high-importance = 4 (no boost)
    expect(results[0].id).toBe("mem-low-importance");
    expect(results[0].importance).toBe(3);
    expect(results[1].id).toBe("mem-high-importance");
    expect(results[1].importance).toBe(4);

    db.close();
  });

  it("(b) effective_importance never exceeds 10", () => {
    expect(computeEffectiveImportance(9, ACCESS_BOOST_THRESHOLD)).toBe(10);
    expect(computeEffectiveImportance(10, ACCESS_BOOST_THRESHOLD)).toBe(10);
    expect(computeEffectiveImportance(10, 100)).toBe(10);
    expect(computeEffectiveImportance(8, ACCESS_BOOST_THRESHOLD)).toBe(10);
    expect(computeEffectiveImportance(9, ACCESS_BOOST_THRESHOLD + 10)).toBe(10);
  });

  it("(c) stored importance unchanged after boost is applied", () => {
    const db = openDb();
    const now = new Date("2026-06-19T12:00:00.000Z");
    const query = "stored importance preservation";

    seedMemory(db, "mem-boosted", "proj-2", 3, query, "2026-06-19T11:00:00.000Z");

    db.prepare(
      "UPDATE memories SET access_count = ? WHERE id = ?",
    ).run(5, "mem-boosted");

    retrieveMemories({
      db,
      projectId: "proj-2",
      queryText: query,
      topK: 1,
      now,
    });

    const row = db
      .prepare("SELECT importance FROM memories WHERE id = ?")
      .get("mem-boosted") as { importance: number };

    expect(row.importance).toBe(3);

    db.close();
  });

  it("(d) resetAccessCounts zeroes counts without deleting memories", () => {
    const db = openDb();

    seedMemory(db, "mem-a", "proj-3", 5, "test", "2026-06-19T10:00:00.000Z");
    seedMemory(db, "mem-b", "proj-3", 7, "test", "2026-06-19T10:00:00.000Z");
    seedMemory(db, "mem-c", "proj-3", 3, "test", "2026-06-19T10:00:00.000Z");

    db.prepare(
      "UPDATE memories SET access_count = 5, last_accessed = '2026-06-19T11:00:00.000Z' WHERE id = ?",
    ).run("mem-a");
    db.prepare(
      "UPDATE memories SET access_count = 10, last_accessed = '2026-06-19T11:30:00.000Z' WHERE id = ?",
    ).run("mem-b");
    db.prepare(
      "UPDATE memories SET access_count = 1, last_accessed = '2026-06-19T10:30:00.000Z' WHERE id = ?",
    ).run("mem-c");

    const affected = resetAccessCounts(db, "proj-3");
    expect(affected).toBe(3);

    const rows = db
      .prepare(
        "SELECT id, importance, content, access_count, last_accessed FROM memories WHERE project_id = ? ORDER BY id",
      )
      .all("proj-3") as Array<{
      id: string;
      importance: number;
      content: string;
      access_count: number;
      last_accessed: string | null;
    }>;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.access_count).toBe(0);
      expect(row.last_accessed).toBeNull();
    }
    expect(rows[0].importance).toBe(5);
    expect(rows[0].content).toBe("memory mem-a");
    expect(rows[1].importance).toBe(7);
    expect(rows[2].importance).toBe(3);

    db.close();
  });

  it("retrieveMemories increments access_count and sets last_accessed", () => {
    const db = openDb();
    const now = new Date("2026-06-19T12:00:00.000Z");
    const query = "increment tracking test";

    seedMemory(db, "mem-track", "proj-4", 5, query, "2026-06-19T11:00:00.000Z");

    const before = db
      .prepare("SELECT access_count, last_accessed FROM memories WHERE id = ?")
      .get("mem-track") as { access_count: number; last_accessed: string | null };
    expect(before.access_count).toBe(0);
    expect(before.last_accessed).toBeNull();

    incrementAccessCounts(db, "proj-4", ["mem-track"]);

    const after = db
      .prepare("SELECT access_count, last_accessed FROM memories WHERE id = ?")
      .get("mem-track") as { access_count: number; last_accessed: string | null };
    expect(after.access_count).toBe(1);
    expect(after.last_accessed).not.toBeNull();

    db.close();
  });
});
