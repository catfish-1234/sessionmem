import { mkdtempSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/core/schema/runMigrations.js";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

describe("Porter FTS migration", () => {
  it("backfills an existing database, preserves rows, and synchronizes later writes", () => {
    const temp = mkdtempSync(join(tmpdir(), "sessionmem-porter-"));
    const source = resolve("src/core/schema/migrations");
    for (const name of readdirSync(source).filter((name) => name.endsWith(".sql") && name < "013")) {
      copyFileSync(join(source, name), join(temp, name));
    }
    const db = openDb({ migrationsDir: temp });
    try {
      // Seed with the legacy schema, before repository writes require the new
      // derived-knowledge tables introduced by migration 014.
      db.prepare(`INSERT INTO memories (id, project_id, session_id, source_adapter, kind, content, normalized_content, importance)
        VALUES ('legacy', 'migration', 's', 'test', 'summary', 'We enjoyed hiking and camping.', 'we enjoyed hiking and camping.', 4)`).run();
      const before = db.prepare("SELECT * FROM memories WHERE id = 'legacy'").get();
      const matches = (term: string) => db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?").all(term);
      expect(matches("hike")).toHaveLength(0);
      runMigrations(db);
      runMigrations(db);
      expect(db.prepare("SELECT * FROM memories WHERE id = 'legacy'").get()).toEqual({ ...(before as Record<string, unknown>), scope: null });
      expect(matches("hike")).toHaveLength(1);
      expect(matches("camp")).toHaveLength(1);
      insertMemory(db, {
        id: "new", project_id: "migration", session_id: "s", source_adapter: "test", kind: "fact",
        content: "She paints portraits.", normalized_content: "she paints portraits.", importance: 5,
      });
      expect(matches("paint")).toHaveLength(1);
      db.prepare("UPDATE memories SET content = ?, normalized_content = ? WHERE id = 'new'")
        .run("She gardens outside.", "she gardens outside.");
      expect(matches("paint")).toHaveLength(0);
      expect(matches("garden")).toHaveLength(1);
      db.prepare("DELETE FROM memories WHERE id = 'new'").run();
      expect(matches("garden")).toHaveLength(0);
      db.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)");
    } finally { db.close(); rmSync(temp, { recursive: true, force: true }); }
  });
});
