import { mkdtempSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { runMigrations } from "../../../src/core/schema/runMigrations.js";
import { entityOverlap, listProjectKnowledge } from "../../../src/core/storage/knowledgeRepo.js";
import { insertMemory, upsertSessionSummaryMemory, updateMemoryContent, deleteMemoryById, upsertImportedMemory, upsertPulledMemory } from "../../../src/core/storage/memoryRepo.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const memory = (id = "m", project_id = "p", content = "Alice uses SQLite.") => ({
  id, project_id, session_id: "s", source_adapter: "test", kind: "fact", content, normalized_content: content, importance: 5,
});

describe("memory knowledge storage", () => {
  it("backfills legacy memories once, preserving their content and IDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "knowledge-migration-"));
    const source = resolve("src/core/schema/migrations");
    for (const name of readdirSync(source).filter(name => name < "014")) copyFileSync(join(source, name), join(directory, name));
    const db = openDb({ migrationsDir: directory });
    try {
      db.prepare(`INSERT INTO memories (id, project_id, session_id, source_adapter, kind, content, normalized_content, importance)
        VALUES ('legacy', 'p', 's', 'test', 'fact', 'Alice uses SQLite.', 'alice uses sqlite.', 5)`).run();
      runMigrations(db);
      const graph = listProjectKnowledge(db, "p", now);
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0]).toMatchObject({ relation: "uses", sourceName: "alice", targetName: "sqlite", memoryIds: ["legacy"] });
      runMigrations(db);
      expect(listProjectKnowledge(db, "p", now)).toEqual(graph);
      expect(db.prepare("SELECT id, content FROM memories").get()).toEqual({ id: "legacy", content: "Alice uses SQLite." });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("replaces graph on summary ID changes and content rewrites, then cascades deletion", () => {
    const db = openDb();
    try {
      upsertSessionSummaryMemory(db, memory());
      upsertSessionSummaryMemory(db, memory("replacement", "p", "Bob uses Docker."));
      expect(listProjectKnowledge(db, "p", now).entities.every(entity => entity.memoryIds[0] === "replacement")).toBe(true);
      expect(listProjectKnowledge(db, "p", now).entities.map(entity => entity.name)).not.toContain("alice");
      updateMemoryContent(db, "p", "replacement", "Use Python.");
      expect(listProjectKnowledge(db, "p", now).entities.map(entity => entity.name)).not.toContain("docker");
      deleteMemoryById(db, "p", "replacement");
      expect(listProjectKnowledge(db, "p", now)).toEqual({ entities: [], relations: [] });
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });

  it("backfills beyond one batch and uses uncapped events for legacy summaries", () => {
    const directory = mkdtempSync(join(tmpdir(), "knowledge-backfill-"));
    const source = resolve("src/core/schema/migrations");
    for (const name of readdirSync(source).filter(name => name < "014")) copyFileSync(join(source, name), join(directory, name));
    const db = openDb({ migrationsDir: directory });
    try {
      const seed = db.prepare(`INSERT INTO memories (id, project_id, session_id, source_adapter, kind, content, normalized_content, importance)
        VALUES (?, 'p', 's', 'test', 'fact', 'Routine note.', 'routine note.', 5)`);
      db.transaction(() => { for (let i = 0; i < 260; i++) seed.run(`old-${i}`); })();
      db.prepare(`INSERT INTO memories (id, project_id, session_id, source_adapter, kind, content, normalized_content, importance)
        VALUES ('summary', 'p', 's', 'test', 'summary', 'Truncated summary.', 'truncated summary.', 5)`).run();
      db.prepare(`INSERT INTO session_events (id, project_id, session_id, event_index, event_type, payload_json)
        VALUES ('event', 'p', 's', 0, 'message', ?)`).run(JSON.stringify({ text: "Zoe works on project Atlas." }));
      runMigrations(db);
      expect(listProjectKnowledge(db, "p", now).relations).toEqual([
        { sourceKind: "person", sourceName: "zoe", relation: "works_on", targetKind: "project", targetName: "atlas", memoryIds: ["summary"] },
      ]);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps provenance, expiry and project boundaries in lists and normalized overlap", () => {
    const db = openDb();
    try {
      insertMemory(db, memory("a"));
      insertMemory(db, memory("b"));
      insertMemory(db, memory("other", "other", "Bob uses Docker."));
      insertMemory(db, { ...memory("expired", "p", "Use Redis."), expires_at: "2025-01-01T00:00:00.000Z" });
      const graph = listProjectKnowledge(db, "p", now);
      expect(graph.entities.find(entity => entity.name === "alice")?.memoryIds).toEqual(["a", "b"]);
      expect(graph.entities.map(entity => entity.name)).not.toContain("docker");
      expect(graph.entities.map(entity => entity.name)).not.toContain("redis");
      expect(entityOverlap(db, "p", "alice's SQLite choice", now)).toEqual(new Map([["a", 1], ["b", 1]]));
      expect(entityOverlap(db, "p", "Docker Redis Malice", now)).toEqual(new Map());
    } finally { db.close(); }
  });

  it("rebuilds derived data on import/pull without changing the export format", () => {
    const db = openDb();
    try {
      upsertImportedMemory(db, memory());
      upsertPulledMemory(db, memory("m", "p", "Bob prefers Docker."));
      expect(listProjectKnowledge(db, "p", now).relations).toEqual([
        { sourceKind: "person", sourceName: "bob", relation: "prefers", targetKind: "tool", targetName: "docker", memoryIds: ["m"] },
      ]);
    } finally { db.close(); }
  });

  it("rolls back both the memory and its graph if indexing fails", () => {
    const db = openDb();
    try {
      insertMemory(db, memory());
      const graph = listProjectKnowledge(db, "p", now);
      db.exec("CREATE TRIGGER fail_knowledge BEFORE INSERT ON memory_entities BEGIN SELECT RAISE(ABORT, 'index failed'); END");
      expect(() => updateMemoryContent(db, "p", "m", "Bob uses Docker.")).toThrow("index failed");
      expect(db.prepare("SELECT content FROM memories WHERE id = 'm'").get()).toEqual({ content: "Alice uses SQLite." });
      expect(listProjectKnowledge(db, "p", now)).toEqual(graph);
      expect(() => insertMemory(db, memory("new"))).toThrow("index failed");
      expect(db.prepare("SELECT id FROM memories WHERE id = 'new'").get()).toBeUndefined();
    } finally { db.close(); }
  });
});
