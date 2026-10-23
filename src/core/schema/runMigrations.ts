import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";
import { indexMemoryKnowledge } from "../storage/knowledgeRepo.js";
import { indexMemorySupersessions } from "../storage/supersessionRepo.js";
import { listSessionEventsBySession } from "../storage/sessionEventsRepo.js";
import { extractEventText } from "../summarize/summaryShape.js";

const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

function listMigrationFiles(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

/** Inspect migration history without creating tables or applying migrations. */
export function inspectMigrations(db: Database, migrationsDir = DEFAULT_MIGRATIONS_DIR): {
  pending: string[];
  unknown: string[];
} {
  const expected = listMigrationFiles(migrationsDir);
  if (expected.length === 0) throw new Error(`No schema migrations found in ${migrationsDir}`);
  const hasHistory = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get();
  const applied = hasHistory
    ? (db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map((row) => row.name)
    : [];
  return {
    pending: expected.filter((name) => !applied.includes(name)),
    unknown: applied.filter((name) => !expected.includes(name)),
  };
}

/**
 * Verify that every column an ADD COLUMN migration declares already exists in
 * its target table. Parses `ALTER TABLE <table> ADD COLUMN <name>` statements
 * from the migration SQL and checks each against `PRAGMA table_info`. Returns
 * false the moment a declared column is missing (or its table doesn't exist),
 * so a partially-applied migration is never marked complete.
 */
function allAddedColumnsExist(db: Database, sql: string): boolean {
  const addColumnRe = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi;
  const byTable = new Map<string, string[]>();
  let match: RegExpExecArray | null;
  while ((match = addColumnRe.exec(sql)) !== null) {
    const [, table, column] = match;
    const cols = byTable.get(table) ?? [];
    cols.push(column);
    byTable.set(table, cols);
  }

  // No ADD COLUMN statements parsed → we cannot prove the schema is consistent,
  // so treat it as unsafe and let the caller re-throw.
  if (byTable.size === 0) {
    return false;
  }

  for (const [table, columns] of byTable) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    for (const column of columns) {
      if (!existing.has(column)) {
        return false;
      }
    }
  }

  return true;
}

export function runMigrations(
  db: Database,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): void {
  // Include history creation and every pending version in one atomic upgrade.
  db.transaction(() => applyMigrations(db, migrationsDir)).immediate();
}

function applyMigrations(db: Database, migrationsDir: string): void {
  ensureMigrationsTable(db);

  const files = listMigrationFiles(migrationsDir);
  const hasMigrationStmt = db.prepare(
    "SELECT name FROM _migrations WHERE name = ? LIMIT 1",
  );
  const insertMigrationStmt = db.prepare(
    "INSERT INTO _migrations(name) VALUES (?)",
  );

  const runMigration = db.transaction((fileName: string) => {
    if (hasMigrationStmt.get(fileName)) return;
    const filePath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(filePath, "utf8");
    db.exec(sql);
    if (fileName === "014_memory_entities.sql") {
      // Backfill in the migration transaction: failures roll back both schema
      // and derived data, and reopening never indexes legacy rows twice.
      // Finish each read before nested write transactions; an active SQLite
      // iterator prevents SAVEPOINT. Batches bound memory use on large stores.
      const batch = db.prepare("SELECT id, content, kind, project_id, session_id FROM memories ORDER BY id LIMIT 256 OFFSET ?");
      for (let offset = 0; ; offset += 256) {
        const rows = batch.all(offset) as Array<{
          id: string; content: string; kind: string; project_id: string; session_id: string;
        }>;
        for (const row of rows) {
          const events = row.kind === "summary" ? listSessionEventsBySession(db, row.project_id, row.session_id) : [];
          indexMemoryKnowledge(db, row.id, events.length ? events.map(extractEventText).join("\n") : row.content);
        }
        if (rows.length < 256) break;
      }
    }
    if (fileName === "015_memory_supersessions.sql") {
      const batch = db.prepare("SELECT id, content, kind, project_id, session_id FROM memories ORDER BY created_at, rowid LIMIT 256 OFFSET ?");
      for (let offset = 0; ; offset += 256) {
        const rows = batch.all(offset) as Array<{ id: string; content: string; kind: string; project_id: string; session_id: string }>;
        for (const row of rows) {
          const events = row.kind === "summary" ? listSessionEventsBySession(db, row.project_id, row.session_id) : [];
          indexMemorySupersessions(db, row.id, row.content,
            events.length ? events.map(event => ({ text: extractEventText(event), observedAt: event.created_at })) : undefined);
        }
        if (rows.length < 256) break;
      }
    }
    insertMigrationStmt.run(fileName);
  });

  for (const fileName of files) {
    if (hasMigrationStmt.get(fileName)) continue;
    try {
      // Serialize the check and apply across processes opening the same DB.
      runMigration.immediate(fileName);
    } catch (err) {
      // Idempotency guard for ALTER TABLE ADD COLUMN migrations (005/006).
      // SQLite has no `ADD COLUMN IF NOT EXISTS`, so re-running a column-adding
      // migration on a DB that already has the column throws "duplicate column
      // name". This only happens when the _migrations record was lost (e.g. the
      // table was dropped) while the schema change survived.
      //
      // Each migration runs in a transaction (all-or-nothing), so the duplicate
      // error rolls the whole body back. Migrations 005/006 add TWO columns
      // each: if only the FIRST already exists, the throw fires on the first
      // ALTER and the second column is never added. Blindly marking the
      // migration applied would leave that second column permanently missing.
      //
      // So instead of trusting the error, verify that EVERY column this
      // migration was supposed to add actually exists. Only then is it safe to
      // record as applied; otherwise re-throw so the failure surfaces.
      if (fileName !== "017_scopes.sql" && err instanceof Error && /duplicate column name/i.test(err.message)) {
        const filePath = path.join(migrationsDir, fileName);
        const sql = fs.readFileSync(filePath, "utf8");
        if (allAddedColumnsExist(db, sql)) {
          db.transaction(() => {
            if (!hasMigrationStmt.get(fileName)) insertMigrationStmt.run(fileName);
          }).immediate();
          continue;
        }
      }
      throw err;
    }
  }
}
