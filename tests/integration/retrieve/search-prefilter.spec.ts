import { describe, expect, it } from "vitest";

import { searchMemoryCandidates } from "../../../src/core/storage/memorySearchRepo.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("searchMemoryCandidates importance/date pre-filter", () => {
  it("includes high-importance memory even when old (> 90 days)", () => {
    const db = openDb();
    const projectId = "prefilter-high-imp-old";

    insertMemory(db, {
      id: "high-imp-old",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "important old memory",
      normalized_content: "important old memory",
      importance: 9,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2020-01-01T12:00:00.000Z",
    });

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("high-imp-old");

    db.close();
  });

  it("excludes low-importance memory when old (> 90 days)", () => {
    const db = openDb();
    const projectId = "prefilter-low-imp-old";

    insertMemory(db, {
      id: "low-imp-old",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "unimportant old memory",
      normalized_content: "unimportant old memory",
      importance: 5,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2020-01-01T12:00:00.000Z",
    });

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(0);

    db.close();
  });

  it("includes low-importance memory when recent (< 90 days)", () => {
    const db = openDb();
    const projectId = "prefilter-low-imp-recent";

    // No explicit updated_at — defaults to 'now' which is always within 90 days
    insertMemory(db, {
      id: "low-imp-recent",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "unimportant recent memory",
      normalized_content: "unimportant recent memory",
      importance: 5,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
    });

    const candidates = searchMemoryCandidates(db, projectId);

    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("low-imp-recent");

    db.close();
  });

  it("returns both high-importance old and low-importance recent, excludes low-importance old", () => {
    const db = openDb();
    const projectId = "prefilter-mixed";

    insertMemory(db, {
      id: "mix-high-old",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "important old",
      normalized_content: "important old",
      importance: 9,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2020-01-01T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "mix-low-old",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "unimportant old",
      normalized_content: "unimportant old",
      importance: 5,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
      updated_at: "2020-01-01T12:00:00.000Z",
    });

    insertMemory(db, {
      id: "mix-low-recent",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "unimportant recent",
      normalized_content: "unimportant recent",
      importance: 5,
      embedding: null,
      embedding_dim: null,
      embedding_version: null,
    });

    const candidates = searchMemoryCandidates(db, projectId);
    const ids = candidates.map((c) => c.id).sort();

    expect(ids).toEqual(["mix-high-old", "mix-low-recent"]);

    db.close();
  });
});
