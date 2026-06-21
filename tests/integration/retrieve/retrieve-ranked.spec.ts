import { describe, expect, it } from "vitest";

import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("retrieveMemories ranking", () => {
  it("ranks by combined semantic, recency, and importance", () => {
    const db = openDb();
    const now = new Date("2026-05-25T12:00:00.000Z");
    const queryText = "roadmap planning status";
    const queryVector = deterministicEmbed(queryText, 8).vector;
    const semanticFirst = queryVector;
    const combinedFirst = queryVector.map((value, index) =>
      index === 0 ? value * 0.2 : value,
    );

    insertMemory(db, {
      id: "memory-semantic-only",
      project_id: "project-1",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Old high-semantic memory",
      normalized_content: "old high semantic memory",
      importance: 1,
      embedding: JSON.stringify(semanticFirst),
      embedding_dim: semanticFirst.length,
      embedding_version: "v1-hash-local",
      updated_at: "2026-05-01T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "memory-combined-wins",
      project_id: "project-1",
      session_id: "session-2",
      source_adapter: "cli",
      kind: "fact",
      content: "Fresh important memory",
      normalized_content: "fresh important memory",
      importance: 10,
      embedding: JSON.stringify(combinedFirst),
      embedding_dim: combinedFirst.length,
      embedding_version: "v1-hash-local",
      updated_at: "2026-05-25T11:00:00.000Z",
    });

    const results = retrieveMemories({
      db,
      projectId: "project-1",
      queryText,
      topK: 2,
      now,
    });

    expect(results[0].id).toBe("memory-combined-wins");
    expect(results[0].semantic).toBeLessThan(results[1].semantic);
    expect(results[0].score.total).toBeGreaterThan(results[1].score.total);

    db.close();
  });

  it("uses deterministic tie-break order by score, updated_at, then id", () => {
    const db = openDb();
    const now = new Date("2026-05-25T12:00:00.000Z");
    const queryText = "deterministic ranking";
    const embedding = deterministicEmbed(queryText, 8).vector;

    insertMemory(db, {
      id: "memory-b",
      project_id: "project-2",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "memory b",
      normalized_content: "memory b",
      importance: 8,
      embedding: JSON.stringify(embedding),
      embedding_dim: embedding.length,
      embedding_version: "v1-hash-local",
      updated_at: "2026-05-23T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "memory-c",
      project_id: "project-2",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "memory c",
      normalized_content: "memory c",
      importance: 8,
      embedding: JSON.stringify(embedding),
      embedding_dim: embedding.length,
      embedding_version: "v1-hash-local",
      updated_at: "2026-05-22T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "memory-a",
      project_id: "project-2",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "memory a",
      normalized_content: "memory a",
      importance: 8,
      embedding: JSON.stringify(embedding),
      embedding_dim: embedding.length,
      embedding_version: "v1-hash-local",
      updated_at: "2026-05-22T12:00:00.000Z",
    });

    const results = retrieveMemories({
      db,
      projectId: "project-2",
      queryText,
      topK: 3,
      now,
    });

    expect(results.map((result) => result.id)).toEqual([
      "memory-b",
      "memory-a",
      "memory-c",
    ]);

    db.close();
  });
});
