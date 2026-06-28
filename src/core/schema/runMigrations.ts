import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";

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
  ensureMigrationsTable(db);

  const files = listMigrationFiles(migrationsDir);
  const hasMigrationStmt = db.prepare(
    "SELECT name FROM _migrations WHERE name = ? LIMIT 1",
  );
  const insertMigrationStmt = db.prepare(
    "INSERT INTO _migrations(name) VALUES (?)",
  );

  const runMigration = db.transaction((fileName: string) => {
    const filePath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(filePath, "utf8");
    db.exec(sql);
    insertMigrationStmt.run(fileName);
  });

  for (const fileName of files) {
    const existing = hasMigrationStmt.get(fileName);
    if (existing) {
      continue;
    }

    try {
      runMigration(fileName);
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
      if (err instanceof Error && /duplicate column name/i.test(err.message)) {
        const filePath = path.join(migrationsDir, fileName);
        const sql = fs.readFileSync(filePath, "utf8");
        if (allAddedColumnsExist(db, sql)) {
          insertMigrationStmt.run(fileName);
          continue;
        }
      }
      throw err;
    }
  }
}
