import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";

const exec = promisify(execFile);
const dirs: string[] = [];
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "sessionmem-db-edge-"));
  dirs.push(dir);
  return join(dir, "memory with spaces.db");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("database edge cases", () => {
  it("initializes a zero-byte SQLite file", () => {
    const dbPath = tempPath();
    writeFileSync(dbPath, "");
    const db = openDb({ dbPath });
    try {
      expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      expect(db.prepare("SELECT COUNT(*) AS count FROM _migrations").get()).toEqual({ count: 15 });
    } finally { db.close(); }
  });

  it("rejects a corrupt file without replacing its bytes", () => {
    const dbPath = tempPath();
    const bytes = Buffer.from("This is not a SQLite database.\r\n");
    writeFileSync(dbPath, bytes);
    expect(() => openDb({ dbPath })).toThrow(/not a database/i);
    expect(readFileSync(dbPath)).toEqual(bytes);
  });

  it("migrates and writes safely from concurrent processes", async () => {
    const dbPath = tempPath();
    const dbModule = pathToFileURL(join(process.cwd(), "dist/core/storage/db.js")).href;
    const eventModule = pathToFileURL(join(process.cwd(), "dist/core/storage/sessionEventsRepo.js")).href;
    const script = `
      import { openDb } from ${JSON.stringify(dbModule)};
      import { insertSessionEvent, nextSessionEventIndex } from ${JSON.stringify(eventModule)};
      const [dbPath, writer] = process.argv.slice(1);
      const db = openDb({ dbPath });
      try {
        const write = db.transaction((id) => insertSessionEvent(db, {
          id, project_id: 'p', session_id: 's',
          event_index: nextSessionEventIndex(db, 'p', 's'),
          event_type: 'tool_use', payload_json: '{}', created_at: null,
        }));
        for (let i = 0; i < 50; i++) write.immediate(writer + '-' + i);
      } finally { db.close(); }
    `;
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, writer) =>
      exec(process.execPath, ["--input-type=module", "-e", script, dbPath, String(writer)]),
    ));
    for (const result of results) expect(result.status, JSON.stringify(result)).toBe("fulfilled");
    const db = openDb({ dbPath });
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM _migrations").get()).toEqual({ count: 15 });
      expect(db.prepare("SELECT event_index FROM session_events ORDER BY event_index").all())
        .toEqual(Array.from({ length: 200 }, (_, event_index) => ({ event_index })));
      expect(db.pragma("quick_check", { simple: true })).toBe("ok");
    } finally { db.close(); }
  });
});
