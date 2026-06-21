import { describe, expect, it } from "vitest";

import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed.js";
import { EMBEDDING_VERSION } from "../../../src/core/embed/embeddingVersion.js";
import { retrieveMemories } from "../../../src/core/retrieve/retrieveMemories.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("embedding version mismatch awareness", () => {
  it("assigns semantic score 0.5 for memory with stale embedding_version", () => {
    const db = openDb();
    const now = new Date("2026-06-20T12:00:00.000Z");
    const queryText = "project setup details";
    const embedding = deterministicEmbed(queryText, 8);

    // Insert a memory with a STALE embedding version
    insertMemory(db, {
      id: "stale-version-memory",
      project_id: "proj-version-test",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Project setup details for stale version test",
      normalized_content: "project setup details for stale version test",
      importance: 7,
      embedding: JSON.stringify(embedding.vector),
      embedding_dim: embedding.dimension,
      embedding_version: "v0-obsolete",
      updated_at: "2026-06-20T10:00:00.000Z",
    });

    // Insert a memory with the CURRENT embedding version
    insertMemory(db, {
      id: "current-version-memory",
      project_id: "proj-version-test",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Project setup details for current version test",
      normalized_content: "project setup details for current version test",
      importance: 7,
      embedding: JSON.stringify(embedding.vector),
      embedding_dim: embedding.dimension,
      embedding_version: EMBEDDING_VERSION,
      updated_at: "2026-06-20T10:00:00.000Z",
    });

    const results = retrieveMemories({
      db,
      projectId: "proj-version-test",
      queryText,
      topK: 10,
      now,
    });

    const staleResult = results.find((r) => r.id === "stale-version-memory");
    const currentResult = results.find((r) => r.id === "current-version-memory");

    expect(staleResult).toBeDefined();
    expect(currentResult).toBeDefined();

    // Stale embedding should get neutral 0.5 semantic score
    expect(staleResult!.semantic).toBe(0.5);

    // Current embedding should get a real cosine similarity (not 0.5)
    expect(currentResult!.semantic).not.toBe(0.5);
    // It should be a valid similarity value (close to 1 for a near-identical query)
    expect(currentResult!.semantic).toBeGreaterThan(0.5);

    db.close();
  });

  it("does not penalize memory with null embedding_version", () => {
    const db = openDb();
    const now = new Date("2026-06-20T12:00:00.000Z");
    const queryText = "null version test";
    const embedding = deterministicEmbed(queryText, 8);

    insertMemory(db, {
      id: "null-version-memory",
      project_id: "proj-null-version",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Memory with null embedding version",
      normalized_content: "memory with null embedding version",
      importance: 5,
      embedding: JSON.stringify(embedding.vector),
      embedding_dim: embedding.dimension,
      // embedding_version defaults to null
      updated_at: "2026-06-20T10:00:00.000Z",
    });

    const results = retrieveMemories({
      db,
      projectId: "proj-null-version",
      queryText,
      topK: 10,
      now,
    });

    const result = results.find((r) => r.id === "null-version-memory");
    expect(result).toBeDefined();
    // null version is a mismatch, so semantic should be 0.5 (neutral)
    expect(result!.semantic).toBe(0.5);

    db.close();
  });
});
