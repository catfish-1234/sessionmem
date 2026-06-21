import { describe, expect, it } from "vitest";

import {
  searchMemoryCandidates,
  searchMemoryCandidatesFTS,
} from "../../../src/core/storage/memorySearchRepo.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("searchMemoryCandidatesFTS", () => {
  it("returns candidates matching FTS keyword query", () => {
    const db = openDb();
    const projectId = "fts-keyword-test";

    // Insert memories with distinct content
    insertMemory(db, {
      id: "mem-alpha",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "TypeScript compiler optimization strategies",
      normalized_content: "typescript compiler optimization strategies",
      importance: 5,
    });

    insertMemory(db, {
      id: "mem-beta",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Database indexing with SQLite WAL mode",
      normalized_content: "database indexing with sqlite wal mode",
      importance: 5,
    });

    insertMemory(db, {
      id: "mem-gamma",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "TypeScript type inference and generics",
      normalized_content: "typescript type inference and generics",
      importance: 5,
    });

    insertMemory(db, {
      id: "mem-delta",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "React component lifecycle hooks",
      normalized_content: "react component lifecycle hooks",
      importance: 5,
    });

    // Insert enough extra memories so FTS can return >= 5
    for (let i = 0; i < 10; i++) {
      insertMemory(db, {
        id: `mem-typescript-extra-${i}`,
        project_id: projectId,
        session_id: "session-1",
        source_adapter: "cli",
        kind: "fact",
        content: `TypeScript pattern number ${i} for advanced use`,
        normalized_content: `typescript pattern number ${i} for advanced use`,
        importance: 3,
      });
    }

    // Search for "TypeScript" — should match mem-alpha, mem-gamma, and the extras
    const results = searchMemoryCandidatesFTS(db, projectId, "TypeScript");

    // Should have at least the 12 TypeScript-related memories
    expect(results.length).toBeGreaterThanOrEqual(12);

    const resultIds = results.map((r) => r.id);
    expect(resultIds).toContain("mem-alpha");
    expect(resultIds).toContain("mem-gamma");
    // SQLite/Database-only memory should NOT match "TypeScript"
    expect(resultIds).not.toContain("mem-beta");
    expect(resultIds).not.toContain("mem-delta");

    db.close();
  });

  it("falls back to full search when FTS returns fewer than 5 results", () => {
    const db = openDb();
    const projectId = "fts-fallback-test";

    // Insert only 3 memories — any FTS query will return < 5 results
    insertMemory(db, {
      id: "fb-mem-1",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Unique xylophone melody composition",
      normalized_content: "unique xylophone melody composition",
      importance: 7,
    });

    insertMemory(db, {
      id: "fb-mem-2",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Database migration patterns",
      normalized_content: "database migration patterns",
      importance: 5,
    });

    insertMemory(db, {
      id: "fb-mem-3",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "API endpoint design principles",
      normalized_content: "api endpoint design principles",
      importance: 3,
    });

    // FTS search for "xylophone" will find only 1 result (< 5 threshold),
    // so it should fall back to full searchMemoryCandidates
    const results = searchMemoryCandidatesFTS(db, projectId, "xylophone");

    // Fallback returns ALL memories for the project (sorted by importance)
    expect(results.length).toBe(3);

    const resultIds = results.map((r) => r.id);
    expect(resultIds).toContain("fb-mem-1");
    expect(resultIds).toContain("fb-mem-2");
    expect(resultIds).toContain("fb-mem-3");

    db.close();
  });

  it("returns same MemorySearchCandidate shape as searchMemoryCandidates", () => {
    const db = openDb();
    const projectId = "fts-shape-test";

    // Insert enough memories with same keyword to exceed fallback threshold
    for (let i = 0; i < 10; i++) {
      insertMemory(db, {
        id: `shape-mem-${i}`,
        project_id: projectId,
        session_id: "session-1",
        source_adapter: "cli",
        kind: "fact",
        content: `JavaScript runtime optimization technique ${i}`,
        normalized_content: `javascript runtime optimization technique ${i}`,
        importance: 5,
      });
    }

    const ftsResults = searchMemoryCandidatesFTS(db, projectId, "JavaScript");
    const fullResults = searchMemoryCandidates(db, projectId);

    expect(ftsResults.length).toBeGreaterThan(0);
    expect(fullResults.length).toBeGreaterThan(0);

    // Both should have the same property keys
    const ftsKeys = Object.keys(ftsResults[0]).sort();
    const fullKeys = Object.keys(fullResults[0]).sort();
    expect(ftsKeys).toEqual(fullKeys);

    db.close();
  });

  it("limits FTS results to 50 candidates", () => {
    const db = openDb();
    const projectId = "fts-limit-test";

    // Insert 100 memories all containing "algorithm"
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        insertMemory(db, {
          id: `limit-mem-${String(i).padStart(3, "0")}`,
          project_id: projectId,
          session_id: "session-1",
          source_adapter: "cli",
          kind: "fact",
          content: `Algorithm analysis technique variant ${i}`,
          normalized_content: `algorithm analysis technique variant ${i}`,
          importance: 5,
        });
      }
    });
    insertMany();

    const results = searchMemoryCandidatesFTS(db, projectId, "algorithm");

    // Should be capped at 50
    expect(results.length).toBe(50);

    db.close();
  });

  it("handles empty query text by falling back to full search", () => {
    const db = openDb();
    const projectId = "fts-empty-query";

    for (let i = 0; i < 6; i++) {
      insertMemory(db, {
        id: `empty-q-${i}`,
        project_id: projectId,
        session_id: "session-1",
        source_adapter: "cli",
        kind: "fact",
        content: `Some content item ${i}`,
        normalized_content: `some content item ${i}`,
        importance: 5,
      });
    }

    // Empty string should fall back to full search
    const results = searchMemoryCandidatesFTS(db, projectId, "   ");
    expect(results.length).toBe(6);

    db.close();
  });

  it("scopes FTS results to the specified project_id", () => {
    const db = openDb();

    // Insert memories in two different projects with same content
    insertMemory(db, {
      id: "proj-a-mem",
      project_id: "project-a",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Kubernetes deployment configuration",
      normalized_content: "kubernetes deployment configuration",
      importance: 5,
    });

    // Add more to project-a to exceed threshold
    for (let i = 0; i < 6; i++) {
      insertMemory(db, {
        id: `proj-a-extra-${i}`,
        project_id: "project-a",
        session_id: "session-1",
        source_adapter: "cli",
        kind: "fact",
        content: `Kubernetes service mesh pattern ${i}`,
        normalized_content: `kubernetes service mesh pattern ${i}`,
        importance: 5,
      });
    }

    insertMemory(db, {
      id: "proj-b-mem",
      project_id: "project-b",
      session_id: "session-1",
      source_adapter: "cli",
      kind: "fact",
      content: "Kubernetes deployment configuration",
      normalized_content: "kubernetes deployment configuration",
      importance: 5,
    });

    const resultsA = searchMemoryCandidatesFTS(db, "project-a", "Kubernetes");
    const resultIds = resultsA.map((r) => r.id);

    // Should NOT include project-b memories
    expect(resultIds).not.toContain("proj-b-mem");
    // Should include project-a memories
    expect(resultIds).toContain("proj-a-mem");

    db.close();
  });
});
