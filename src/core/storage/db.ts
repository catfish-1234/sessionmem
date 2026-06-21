import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runMigrations } from "../schema/runMigrations.js";

export interface OpenDbOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export function openDb(options: OpenDbOptions = {}): Database {
  const db = new BetterSqlite3(options.dbPath ?? ":memory:");

  // Performance pragmas — WAL enables concurrent reads during writes;
  // busy_timeout prevents SQLITE_BUSY under concurrent MCP tool calls.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -32000");

  runMigrations(db, options.migrationsDir);
  return db;
}
