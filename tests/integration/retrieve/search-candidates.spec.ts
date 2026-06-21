import { describe, expect, it } from "vitest";

import { searchMemoryCandidates } from "../../../src/core/storage/memorySearchRepo.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("searchMemoryCandidates pre-filter", () => {
  it("includes all recent memories regardless of importance", () => {
    const db = openDb();
    const projectId = "project-recent-test";

    insertMemory(db, {
      id: "recent-low-imp",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "recent low importance",
      normalized_content: "recent low importance",
      importance: 3,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
    });

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("recent-low-imp");

    db.close();
  });

  it("includes high-importance memories regardless of age", () => {
    const db = openDb();
    const projectId = "project-high-imp";

    insertMemory(db, {
      id: "old-high-imp",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "old high importance",
      normalized_content: "old high importance",
      importance: 9,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2020-01-01T12:00:00.000Z",
    });

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("old-high-imp");

    db.close();
  });

  it("filters by project_id", () => {
    const db = openDb();

    insertMemory(db, {
      id: "proj-a-mem",
      project_id: "project-a",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "project a memory",
      normalized_content: "project a memory",
      importance: 8,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
    });

    insertMemory(db, {
      id: "proj-b-mem",
      project_id: "project-b",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "project b memory",
      normalized_content: "project b memory",
      importance: 8,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
    });

    const candidatesA = searchMemoryCandidates(db, "project-a");
    const candidatesB = searchMemoryCandidates(db, "project-b");

    expect(candidatesA.length).toBe(1);
    expect(candidatesA[0].id).toBe("proj-a-mem");
    expect(candidatesB.length).toBe(1);
    expect(candidatesB[0].id).toBe("proj-b-mem");

    db.close();
  });
});
