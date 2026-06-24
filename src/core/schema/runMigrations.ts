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
    if (!existing) {
      runMigration(fileName);
    }
  }
}
