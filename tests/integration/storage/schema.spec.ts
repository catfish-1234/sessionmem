import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

    expect(indexExists(db, "idx_memories_project_updated")).toBe(true);
    expect(indexExists(db, "idx_memories_project_session")).toBe(true);
    expect(indexExists(db, "idx_memories_project_importance")).toBe(true);
    expect(indexExists(db, "idx_memories_project_created")).toBe(true);
    expect(
      indexExists(db, "idx_session_events_project_session_event_index"),
    ).toBe(true);
    expect(indexExists(db, "idx_sum_fail_project_session")).toBe(true);

    db.close();
  });

  it("tracks applied migrations and remains idempotent", () => {
    const db = openDb({ dbPath: createTempDbPath() });

    runMigrations(db);
    runMigrations(db);

    const countRow = db
      .prepare("SELECT COUNT(*) AS count FROM _migrations")
      .get() as { count: number };
    expect(countRow.count).toBe(3);

    const names = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual([
      "001_initial.sql",
      "002_indexes.sql",
      "003_summarization_failures.sql",
    ]);

    db.close();
  });
});
