import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runMigrations } from "../schema/runMigrations.js";

export interface OpenDbOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export function openDb(options: OpenDbOptions = {}): Database {
  const db = new BetterSqlite3(options.dbPath ?? ":memory:");

  try {
    // Roll back the entire upgrade before any persistent journal-mode change.
    // A failed migration must leave the existing database file untouched.
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    runMigrations(db, options.migrationsDir);
    // Performance pragmas — WAL enables concurrent reads during writes;
    // busy_timeout prevents SQLITE_BUSY under concurrent MCP tool calls.
    // Concurrent first opens can race while switching to WAL. SQLite may
    // bypass the busy handler for this lock upgrade, so retry within the same
    // five-second budget used for normal writes.
    const deadline = Date.now() + 5000;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      try {
        db.pragma("journal_mode = WAL");
        break;
      } catch (err) {
        if (!(err instanceof Error) || !("code" in err) || err.code !== "SQLITE_BUSY" || Date.now() >= deadline) {
          throw err;
        }
        Atomics.wait(pause, 0, 0, 10);
      }
    }
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("cache_size = -32000");

    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
