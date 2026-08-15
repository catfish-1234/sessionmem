import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import {
  searchMemoryCandidates,
  searchMemoryCandidatesFTS,
} from "../../../src/core/storage/memorySearchRepo.js";

/**
 * The candidate pre-filter used to compute its 90-day recency window from
 * SQL's own `strftime('now')`, ignoring the clock the caller passed in. That
 * made retrieval untestable (fixed-date fixtures drifted out of the window as
 * real calendar time advanced) and meant `retrieveMemories({ now })` silently
 * scored against a different window than it filtered on.
 */
describe("candidate pre-filter honors the injected clock", () => {
  const projectId = "clock-project";

  function seed() {
    const db = openDb();
    insertMemory(db, {
      id: "recent-low-importance",
      project_id: projectId,
      session_id: "s1",
      source_adapter: "cli",
      kind: "fact",
      content: "Recent but unimportant note",
      normalized_content: "recent but unimportant note",
      importance: 1,
      updated_at: "2026-05-01T12:00:00.000Z",
    });
    return db;
  }

  it("includes a row inside the window for a `now` shortly after it", () => {
    const db = seed();
    const candidates = searchMemoryCandidates(
      db,
      projectId,
      new Date("2026-05-25T12:00:00.000Z"),
    );
    expect(candidates.map((c) => c.id)).toContain("recent-low-importance");
    db.close();
  });

  it("excludes the same row for a `now` more than 90 days later", () => {
    const db = seed();
    const candidates = searchMemoryCandidates(
      db,
      projectId,
      new Date("2027-01-01T12:00:00.000Z"),
    );
    expect(candidates.map((c) => c.id)).not.toContain("recent-low-importance");
    db.close();
  });

  it("threads the clock through the FTS fallback path", () => {
    const db = seed();
    // A query with no lexical overlap falls back to the recency/importance scan.
    const early = searchMemoryCandidatesFTS(
      db,
      projectId,
      "zzz nonmatching query",
      new Date("2026-05-25T12:00:00.000Z"),
    );
    const late = searchMemoryCandidatesFTS(
      db,
      projectId,
      "zzz nonmatching query",
      new Date("2027-01-01T12:00:00.000Z"),
    );

    expect(early.map((c) => c.id)).toContain("recent-low-importance");
    expect(late.map((c) => c.id)).not.toContain("recent-low-importance");
    db.close();
  });
});
