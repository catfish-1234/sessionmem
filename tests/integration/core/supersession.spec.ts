import { mkdtempSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blockNetwork } from "../../../benchmarks/lib/offline.mjs";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory, upsertImportedMemory, updateMemoryContent, upsertSessionSummaryMemory, deleteMemoryById } from "../../../src/core/storage/memoryRepo.js";
import { listSupersessions } from "../../../src/core/storage/supersessionRepo.js";
import { runMigrations } from "../../../src/core/schema/runMigrations.js";

const day = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
const input = (id: string, content: string, date = day(1), project_id = "p") => ({ id, project_id,
  session_id: id, source_adapter: "test", kind: "fact", content, normalized_content: content,
  importance: 5, created_at: date, updated_at: date });

describe("supersession capture and recall", () => {
  it("prefers the latest fact, retains history and chains negation/reaffirmation offline", async () => {
    const offline = blockNetwork();
    const db = openDb();
    try {
      let now = day(1);
      const service = createMemoryCoreService({ db, now: () => new Date(now) });
      const store = (memoryId: string, content: string) => service.storeMemory({ memoryId, projectId: "p",
        sessionId: memoryId, sourceAdapter: "test", kind: "fact", content, importance: 5 });
      const stored = await store("old", "I use VS Code.");
      expect(Object.keys(stored).sort()).toEqual(["memory", "ok", "warningCodes"]);
      now = day(2);
      await store("current", "I switched to Neovim.");
      const query = { projectId: "p", query: "VS Code Neovim editor", limit: 5, mode: "on-demand" as const };
      expect((await service.retrieveMemories(query)).memories.map(m => m.id)).toEqual(["current"]);
      expect((await service.retrieveMemories({ ...query, includeHistory: true })).memories.map(m => m.id).sort()).toEqual(["current", "old"]);
      expect((await service.getMemory({ projectId: "p", memoryId: "old" })).memory.content).toBe("I use VS Code.");
      now = day(3);
      await service.batchStoreMemory({ projectId: "p", memories: [{ memoryId: "negative", sessionId: "n", sourceAdapter: "test",
        kind: "fact", content: "I no longer use Neovim.", importance: 5 }] });
      upsertImportedMemory(db, input("again", "I use Neovim.", day(4)));
      expect(listSupersessions(db, "p").map(l => [l.supersedes, l.supersededBy, l.reason])).toEqual([
        ["old", "current", "different_value"], ["current", "negative", "explicit_negation"], ["negative", "again", "explicit_negation"],
      ]);
      const history = await service.exportMemories({ projectId: "p" });
      expect(history.memories).toHaveLength(4);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      offline.assertOffline();
    } finally { db.close(); offline.restore(); }
  });

  it("reconciles out-of-order imports, rewrites and replays without cycles or duplicate links", () => {
    const db = openDb();
    try {
      upsertImportedMemory(db, input("new", "I use Neovim.", day(3)));
      upsertImportedMemory(db, input("old", "I use VS Code.", day(1)));
      upsertImportedMemory(db, input("middle", "I use Emacs.", day(2)));
      expect(listSupersessions(db, "p").map(l => [l.supersedes, l.supersededBy])).toEqual([["old", "middle"], ["middle", "new"]]);
      const links = listSupersessions(db, "p");
      upsertImportedMemory(db, input("middle", "I use Emacs.", day(2)));
      expect(listSupersessions(db, "p")).toEqual(links);
      deleteMemoryById(db, "p", "middle");
      expect(listSupersessions(db, "p").map(l => [l.supersedes, l.supersededBy])).toEqual([["old", "new"]]);
      upsertImportedMemory(db, input("middle", "I use Emacs.", day(2)));
      updateMemoryContent(db, "p", "middle", "Bob uses Docker.");
      expect(listSupersessions(db, "p").map(l => [l.supersedes, l.supersededBy])).toEqual([["old", "new"]]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("preserves unrelated claims in a summary and handles equal-clock capture order", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, now: () => new Date(day(2)) });
      insertMemory(db, input("mixed", "I use VS Code. Alice uses Docker."));
      insertMemory(db, input("new", "I use Neovim."));
      expect(listSupersessions(db, "p")[0]).toMatchObject({ supersedes: "mixed", supersededBy: "new", fullySuperseded: false });
      expect((await service.retrieveMemories({ projectId: "p", query: "Alice Docker" })).memories.map(m => m.id)).toContain("mixed");
      insertMemory(db, input("other-project", "I use Emacs.", day(2), "other"));
      expect(listSupersessions(db, "other")).toEqual([]);
      insertMemory(db, { ...input("expired", "I use Emacs.", day(3)), expires_at: day(2) });
      expect(listSupersessions(db, "p")).toHaveLength(1);
    } finally { db.close(); }
  });

  it("rolls back memory, knowledge and links together if supersession indexing fails", () => {
    const db = openDb();
    try {
      insertMemory(db, input("old", "I use VS Code."));
      db.exec("CREATE TRIGGER fail_links BEFORE INSERT ON memory_supersessions BEGIN SELECT RAISE(ABORT, 'link failed'); END");
      expect(() => insertMemory(db, input("new", "I use Neovim.", day(2)))).toThrow("link failed");
      expect(db.prepare("SELECT id FROM memories WHERE id = 'new'").get()).toBeUndefined();
      expect(db.prepare("SELECT memory_id FROM memory_entities WHERE memory_id = 'new'").all()).toEqual([]);
      expect(listSupersessions(db, "p")).toEqual([]);
    } finally { db.close(); }
  });

  it("filters stale facts before the candidate cap even when they match the query better", async () => {
    const db = openDb();
    try {
      for (let i = 0; i < 60; i++) insertMemory(db, { ...input(`old-${i}`, "I use VS Code."), importance: 10 });
      insertMemory(db, { ...input("current", "I switched to Neovim.", day(2)), importance: 1 });
      const service = createMemoryCoreService({ db, now: () => new Date(day(3)) });
      const query = { projectId: "p", query: "VS Code", mode: "on-demand" as const };
      expect((await service.retrieveMemories(query)).memories.map(m => m.id)).toEqual(["current"]);
      expect((await service.retrieveMemories({ ...query, includeHistory: true })).memories.some(m => m.id.startsWith("old-"))).toBe(true);
    } finally { db.close(); }
  });

  it("backfills migration 015 once, including the full event source for summaries", () => {
    const directory = mkdtempSync(join(tmpdir(), "supersession-migration-"));
    const source = resolve("src/core/schema/migrations");
    for (const name of readdirSync(source).filter(name => name < "015")) copyFileSync(join(source, name), join(directory, name));
    const db = openDb({ migrationsDir: directory });
    try {
      const seed = db.prepare(`INSERT INTO memories (id, project_id, session_id, source_adapter, kind, content, normalized_content, importance, created_at)
        VALUES (?, 'p', ?, 'test', ?, ?, '', 5, ?)`);
      seed.run("old", "old", "fact", "I use VS Code.", day(1));
      seed.run("summary", "s", "summary", "Truncated content.", day(2));
      db.prepare(`INSERT INTO session_events (id, project_id, session_id, event_index, event_type, payload_json, created_at)
        VALUES ('e', 'p', 's', 0, 'message', ?, ?)`).run(JSON.stringify({ text: "I switched to Neovim." }), day(2));
      runMigrations(db);
      expect(listSupersessions(db, "p")).toMatchObject([{ supersedes: "old", supersededBy: "summary", supersededAt: day(2) }]);
      const links = listSupersessions(db, "p");
      runMigrations(db);
      expect(listSupersessions(db, "p")).toEqual(links);
      upsertSessionSummaryMemory(db, { ...input("renamed", "I use Neovim.", day(2)), session_id: "s" });
      expect(listSupersessions(db, "p")[0].supersededBy).toBe("renamed");
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.prepare("SELECT content FROM memories WHERE id = 'old'").get()).toEqual({ content: "I use VS Code." });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
