import { describe, expect, it } from "vitest";

import { searchMemoryCandidates } from "../../../src/core/storage/memorySearchRepo.js";
import { MAX_SEMANTIC_CANDIDATES } from "../../../src/core/config/policyConfig.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("searchMemoryCandidates candidate limit", () => {
  it("returns at most MAX_SEMANTIC_CANDIDATES rows when DB has more", () => {
    const db = openDb();
    const total = 3000;
    const projectId = "project-limit-test";

    // Insert 3000 memories with varying importance and timestamps
    const insertMany = db.transaction(() => {
      for (let i = 0; i < total; i++) {
        insertMemory(db, {
          id: `mem-${String(i).padStart(5, "0")}`,
          project_id: projectId,
          session_id: "session-1",
          source_adapter: "cli",
          kind: "fact",
          content: `memory content ${i}`,
          normalized_content: `memory content ${i}`,
          importance: (i % 10) + 1,
          embedding: null,
          embedding_dim: null,
          embedding_version: null,
        });
      }
    });
    insertMany();

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(MAX_SEMANTIC_CANDIDATES);
    expect(candidates.length).toBeLessThan(total);

    db.close();
  });

  it("returns all rows when DB has fewer than MAX_SEMANTIC_CANDIDATES", () => {
    const db = openDb();
    const total = 50;
    const projectId = "project-small";

    const insertMany = db.transaction(() => {
      for (let i = 0; i < total; i++) {
        insertMemory(db, {
          id: `small-${String(i).padStart(3, "0")}`,
          project_id: projectId,
          session_id: "session-1",
          source_adapter: "cli",
          kind: "fact",
          content: `small memory ${i}`,
          normalized_content: `small memory ${i}`,
          importance: 5,
          embedding: null,
          embedding_dim: null,
          embedding_version: null,
        });
      }
    });
    insertMany();

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(total);

    db.close();
  });

  it("orders candidates by importance DESC then updated_at DESC", () => {
    const db = openDb();
    const projectId = "project-order-test";

    insertMemory(db, {
      id: "low-imp-recent",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "low importance recent",
      normalized_content: "low importance recent",
      importance: 1,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2026-06-20T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "high-imp-old",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "high importance old",
      normalized_content: "high importance old",
      importance: 10,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2026-01-01T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "high-imp-recent",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "high importance recent",
      normalized_content: "high importance recent",
      importance: 10,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2026-06-20T12:00:00.000Z",
    });

    const candidates = searchMemoryCandidates(db, projectId);

    // High importance first, then by recency within same importance
    expect(candidates[0].id).toBe("high-imp-recent");
    expect(candidates[1].id).toBe("high-imp-old");
    expect(candidates[2].id).toBe("low-imp-recent");

    db.close();
  });
});
