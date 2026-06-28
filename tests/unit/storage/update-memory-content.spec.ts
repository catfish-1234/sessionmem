import { describe, expect, it } from "vitest";
import {
  getMemoryRecordById,
  insertMemory,
  updateMemoryContent,
} from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

const PROJECT_ID = "project-update-content";

function seed(db: ReturnType<typeof openDb>, id: string, content: string): void {
  insertMemory(db, {
    id,
    project_id: PROJECT_ID,
    session_id: "session-1",
    source_adapter: "codex",
    kind: "fact",
    content,
    normalized_content: content.toLowerCase(),
    importance: 5,
    embedding: JSON.stringify([0.1, 0.2, 0.3]),
    embedding_dim: 3,
    embedding_version: "v-original",
  });
}

describe("updateMemoryContent", () => {
  it("backward-compat: omitting the embedding arg leaves the stored vector untouched (COALESCE)", () => {
    const db = openDb();
    seed(db, "mem-1", "the original elephant content");

    // Old-style call: content + normalizedContent only, no embedding object.
    updateMemoryContent(
      db,
      PROJECT_ID,
      "mem-1",
      "the rewritten giraffe content",
      "the rewritten giraffe content",
    );

    const row = getMemoryRecordById(db, PROJECT_ID, "mem-1");
    expect(row?.content).toBe("the rewritten giraffe content");
    // Embedding columns are preserved exactly — the no-embedding path must not
    // null them out (the UPDATE uses COALESCE on each embedding column).
    expect(row?.embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]));
    expect(row?.embedding_dim).toBe(3);
    expect(row?.embedding_version).toBe("v-original");

    db.close();
  });

  it("keeps the FTS index consistent after a content update", () => {
    const db = openDb();
    seed(db, "mem-1", "the original elephant content");

    const { rowid } = db
      .prepare("SELECT rowid FROM memories WHERE id = ?")
      .get("mem-1") as { rowid: number };

    updateMemoryContent(
      db,
      PROJECT_ID,
      "mem-1",
      "the rewritten giraffe content",
      "the rewritten giraffe content",
    );

    // FTS UPDATE trigger (migration 008) re-indexes on content change. Query the
    // FTS virtual table directly (the public search helper falls back to a full
    // scan on a 0-hit term, which would mask a stale-index bug). The new term
    // must match this row; the old term must no longer match it.
    const matchRowids = (term: string): number[] =>
      (
        db
          .prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?")
          .all(term) as { rowid: number }[]
      ).map((r) => r.rowid);

    expect(matchRowids("giraffe")).toContain(rowid);
    expect(matchRowids("elephant")).not.toContain(rowid);

    db.close();
  });

  it("throws when the target memory does not exist", () => {
    const db = openDb();
    expect(() =>
      updateMemoryContent(db, PROJECT_ID, "missing", "x", "x"),
    ).toThrow(/not found/i);
    db.close();
  });
});
