import { afterEach, describe, expect, it } from "vitest";
import Database, { type Database as Db } from "better-sqlite3";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../../src/core/storage/db.js";

const fixture = fileURLToPath(new URL("../../fixtures/storage/pre-scopes-v16.db", import.meta.url));
const migrations = fileURLToPath(new URL("../../../src/core/schema/migrations/", import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temporary() { const dir = mkdtempSync(join(tmpdir(), "sessionmem-scopes-upgrade-")); dirs.push(dir); return dir; }
function snapshot(db: Db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
}

describe("scope upgrade from a committed pre-scope database file", () => {
  it("upgrades on first open, preserves every old table and value, and is idempotent", () => {
    const path = join(temporary(), "existing.db");
    copyFileSync(fixture, path);
    const old = new Database(path, { readonly: true });
    const before = snapshot(old);
    expect((before._migrations as any[]).length).toBe(16);
    expect(old.prepare("PRAGMA table_info(memories)").all()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "scope" })]));
    old.close();
    const db = openDb({ dbPath: path });
    for (const [table, rows] of Object.entries(before)) {
      if (table === "_migrations") {
        expect(db.prepare("SELECT * FROM _migrations WHERE name != '017_scopes.sql'").all()).toEqual(rows);
        continue;
      }
      const columns = Object.keys((rows as any[])[0] ?? {}).map(name => `"${name}"`).join(", ");
      if (columns) expect(db.prepare(`SELECT ${columns} FROM "${table}"`).all()).toEqual(rows);
      else expect(db.prepare(`SELECT * FROM "${table}"`).all()).toEqual([]);
    }
    expect(db.prepare("SELECT DISTINCT scope FROM memories").all()).toEqual([{ scope: null }]);
    expect(db.prepare("SELECT DISTINCT scope FROM memory_entities").all()).toEqual([{ scope: null }]);
    expect(db.prepare("SELECT * FROM sessions ORDER BY project_id").all()).toEqual([
      { project_id: "other", session_id: "s", scope: null }, { project_id: "p", session_id: "s", scope: null },
    ]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
    const again = openDb({ dbPath: path });
    expect(again.prepare("SELECT COUNT(*) AS n FROM _migrations").get()).toEqual({ n: 17 });
    expect(again.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 2 });
    again.close();
  });

  it.each(["DELETE", "WAL"])("leaves the original %s-mode file byte-identical when a migration fails", mode => {
    const dir = temporary(), path = join(dir, "existing.db"), custom = temporary();
    copyFileSync(fixture, path);
    const old = new Database(path);
    old.pragma(`journal_mode = ${mode}`);
    old.close();
    const original = readFileSync(path);
    for (const name of readdirSync(migrations)) copyFileSync(join(migrations, name), join(custom, name));
    // The failure follows the real scope DDL and an attempted destructive write.
    writeFileSync(join(custom, "018_failure.sql"), "DELETE FROM memories; CREATE TABLE partial_upgrade(id); SELECT missing_migration_function();");
    expect(() => openDb({ dbPath: path, migrationsDir: custom })).toThrow(/missing_migration_function/);
    expect(readFileSync(path)).toEqual(original);
    const check = new Database(path, { readonly: true });
    expect(check.prepare("SELECT COUNT(*) AS n FROM _migrations").get()).toEqual({ n: 16 });
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN ('sessions', 'partial_upgrade')").all()).toEqual([]);
    expect(check.prepare("SELECT COUNT(*) AS n FROM memories").get()).toEqual({ n: 2 });
    check.close();
    const recovered = openDb({ dbPath: path });
    expect(recovered.prepare("SELECT COUNT(*) AS n FROM memories").get()).toEqual({ n: 2 });
    recovered.close();
  });
});
