import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { runMigrations } from "../../../src/core/schema/runMigrations.js";
import { openDb } from "../../../src/core/storage/db.js";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "sessionmem-schema-"));
  tempDirs.push(dirPath);
  return path.join(dirPath, "sessionmem.db");
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName);

  return Boolean(row);
}

function indexExists(db: Database, indexName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
    )
    .get(indexName);

  return Boolean(row);
}

function columnNames(db: Database, tableName: string): string[] {
  const rows = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("schema migrations", () => {
  afterEach(() => {
    for (const dirPath of tempDirs.splice(0)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  });

  it("creates required tables and indexes from clean database", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    expect(tableExists(db, "_migrations")).toBe(true);
    expect(tableExists(db, "session_events")).toBe(true);
    expect(tableExists(db, "memories")).toBe(true);
    expect(tableExists(db, "summarization_failures")).toBe(true);
    expect(tableExists(db, "memory_feedback")).toBe(true);

    expect(indexExists(db, "idx_memories_project_updated")).toBe(true);
    expect(indexExists(db, "idx_memories_project_session")).toBe(true);
    expect(indexExists(db, "idx_memories_project_importance")).toBe(true);
    expect(indexExists(db, "idx_memories_project_created")).toBe(true);
    expect(
      indexExists(db, "idx_session_events_project_session_event_index"),
    ).toBe(true);
    expect(indexExists(db, "idx_sum_fail_project_session")).toBe(true);
    expect(indexExists(db, "idx_memory_feedback_memory_created")).toBe(true);

    db.close();
  });

  it("tracks applied migrations and remains idempotent", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    runMigrations(db);
    runMigrations(db);

    const countRow = db
      .prepare("SELECT COUNT(*) AS count FROM _migrations")
      .get() as { count: number };
    expect(countRow.count).toBe(7);

    const names = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual([
      "001_initial.sql",
      "002_indexes.sql",
      "003_summarization_failures.sql",
      "004_memory_feedback.sql",
      "005_team_provenance.sql",
      "006_access_pattern_boosting.sql",
      "007_feedback_manual_delete.sql",
    ]);

    db.close();
  });

  it("adds author and origin_project_id columns via migration 005", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    const columns = columnNames(db, "memories");
    expect(columns).toContain("author");
    expect(columns).toContain("origin_project_id");

    db.close();
  });

  it("preserves a pre-005 row and backfills author='' / origin_project_id=NULL", () => {
    const dbPath = createTempDbPath();

    // Simulate a pre-005 database: apply only the migrations that predate
    // team-provenance by pointing the runner at a temp dir holding 001-004.
    const baseMigrationsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sessionmem-mig-"),
    );
    tempDirs.push(baseMigrationsDir);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sourceMigrationsDir = path.resolve(
      here,
      "../../../src/core/schema/migrations",
    );
    for (const name of [
      "001_initial.sql",
      "002_indexes.sql",
      "003_summarization_failures.sql",
      "004_memory_feedback.sql",
    ]) {
      fs.copyFileSync(
        path.join(sourceMigrationsDir, name),
        path.join(baseMigrationsDir, name),
      );
    }

    const legacyDb = openDb({ dbPath, migrationsDir: baseMigrationsDir });
    legacyDb
      .prepare(
        `INSERT INTO memories (
          id, project_id, session_id, source_adapter, kind, content,
          normalized_content, importance
        ) VALUES (
          'legacy-1', 'proj-a', 'sess-1', 'codex', 'fact', 'old content',
          'old content', 5
        )`,
      )
      .run();
    legacyDb.close();

    // Re-open with the full migration set (now including 005).
    const db = openDb({ dbPath });

    const row = db
      .prepare(
        "SELECT id, content, author, origin_project_id FROM memories WHERE id = 'legacy-1'",
      )
      .get() as {
      id: string;
      content: string;
      author: string;
      origin_project_id: string | null;
    };

    expect(row.id).toBe("legacy-1");
    expect(row.content).toBe("old content");
    expect(row.author).toBe("");
    expect(row.origin_project_id).toBeNull();

    db.close();
  });

  it("adds access_count and last_accessed columns via migration 006", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    const columns = columnNames(db, "memories");
    expect(columns).toContain("access_count");
    expect(columns).toContain("last_accessed");

    db.prepare(
      `INSERT INTO memories (
        id, project_id, session_id, source_adapter, kind, content,
        normalized_content, importance, author
      ) VALUES (
        'mem-006', 'proj-a', 'sess-1', 'test', 'fact', 'hello', 'hello', 5, 'bob'
      )`,
    ).run();

    const row = db
      .prepare(
        "SELECT access_count, last_accessed FROM memories WHERE id = 'mem-006'",
      )
      .get() as { access_count: number; last_accessed: string | null };

    expect(row.access_count).toBe(0);
    expect(row.last_accessed).toBeNull();

    db.close();
  });

  it("opens database in WAL journal mode", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe("wal");

    db.close();
  });

  it("exposes string author and string|null origin_project_id on stored rows", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    db.prepare(
      `INSERT INTO memories (
        id, project_id, session_id, source_adapter, kind, content,
        normalized_content, importance, author
      ) VALUES (
        'mem-1', 'proj-a', 'sess-1', 'codex', 'fact', 'hello', 'hello', 5, 'alice'
      )`,
    ).run();

    const row = db
      .prepare(
        "SELECT author, origin_project_id FROM memories WHERE id = 'mem-1'",
      )
      .get() as { author: string; origin_project_id: string | null };

    expect(typeof row.author).toBe("string");
    expect(row.author).toBe("alice");
    expect(row.origin_project_id).toBeNull();

    db.close();
  });
});
