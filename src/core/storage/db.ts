import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runMigrations } from "../schema/runMigrations.js";

export interface OpenDbOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export function openDb(options: OpenDbOptions = {}): Database {
  const db = new BetterSqlite3(options.dbPath ?? ":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, options.migrationsDir);
  return db;
}
