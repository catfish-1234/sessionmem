import BetterSqlite3, { type Database } from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliContext, type CliContext } from "../../../src/cli/context.js";
import { deriveProjectId } from "../../../src/cli/projectId.js";
import { sweepTranscripts } from "../../../src/cli/transcriptSweep.js";
import { watchCommand } from "../../../src/cli/commands/watch.js";
import { cursorUserDirectory, readCursorTranscripts } from "../../../src/cli/transcripts/cursor.js";
import { inspectTranscriptDiscovery, transcriptSources } from "../../../src/cli/transcripts/index.js";
import { listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";
import { listSessionEventsBySession } from "../../../src/core/storage/sessionEventsRepo.js";

const execFileAsync = promisify(execFile);
let dir: string;
let user: string;
let path: string;
let cwd: string;
let projectId: string;
let context: CliContext;
let databases: Database[];

function database(path: string): Database {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new BetterSqlite3(path);
  databases.push(db);
  return db;
}

function put(db: Database, table: string, key: string, value: unknown): void {
  db.prepare(`INSERT OR REPLACE INTO ${table} (key, value) VALUES (?, ?)`).run(key, JSON.stringify(value));
}

function fixture(layout: "central" | "legacy" = "central", id = "composer-1"): Database {
  const db = database(path);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB); CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
  if (layout === "central") {
    put(db, "ItemTable", "composer.composerHeaders", [{ composerId: id, workspaceIdentifier: { uri: { fsPath: cwd } } }]);
  } else {
    const workspace = join(user, "workspaceStorage", "workspace-id");
    const index = database(join(workspace, "state.vscdb"));
    index.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    put(index, "ItemTable", "composer.composerData", { allComposers: [{ composerId: id }] });
    writeFileSync(join(workspace, "workspace.json"), JSON.stringify({ folder: pathToFileURL(cwd).href }));
    index.close();
  }
  put(db, "cursorDiskKV", `composerData:${id}`, { fullConversationHeadersOnly: [{ bubbleId: "z-user" }, { bubbleId: "a-assistant" }] });
  put(db, "cursorDiskKV", `bubbleId:${id}:z-user`, { type: 1, text: "Use SQLite for local storage.", createdAt: 1792231200000, context: "context-sentinel" });
  put(db, "cursorDiskKV", `bubbleId:${id}:a-assistant`, { type: 2, text: "Added the local database.", createdAt: "2026-10-17T10:00:01.000Z", toolFormerData: { result: "tool-sentinel" } });
  return db;
}

function events(id = "composer-1", project = projectId) { return listSessionEventsBySession(context.db, project, id); }
function memories() { return listMemoriesByProject(context.db, projectId); }
function sweep() { return sweepTranscripts(context, { host: "cursor", transcriptsDir: user }); }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sessionmem-cursor-transcripts-"));
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  vi.stubEnv("APPDATA", dir);
  vi.stubEnv("SESSIONMEM_PROJECT_ID", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  user = cursorUserDirectory();
  path = join(user, "globalStorage", "state.vscdb");
  cwd = join(dir, "repo with spaces");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  projectId = deriveProjectId(cwd);
  context = createCliContext({ dbPath: join(dir, "memories.db") });
  databases = [];
});

afterEach(() => {
  for (const db of databases) if (db.open) db.close();
  context.db.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  rmSync(dir, { recursive: true, force: true });
});

describe("Cursor SQLite transcripts", () => {
  it.each(["central", "legacy"] as const)("extracts ordered messages from the %s index and leaves source files unchanged", async layout => {
    fixture(layout).close();
    const source = readFileSync(path);
    const names = readdirSync(join(user, "globalStorage"));
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await sweep()).toEqual({ filesFound: 1, sessionsImported: 1, memoriesCreated: 1, skipped: 0, errors: 0 });
    expect(events().map(event => event.event_type)).toEqual(["message:user", "message:assistant"]);
    expect(events()[0].created_at).toBe("2026-10-17T10:00:00.000Z");
    expect(memories()[0]).toMatchObject({ session_id: "composer-1", source_adapter: "cursor" });
    expect(memories()[0].content.toLowerCase()).toContain("sqlite");
    expect(JSON.stringify([events(), memories()])).not.toMatch(/context-sentinel|tool-sentinel/);
    expect(readFileSync(path)).toEqual(source);
    expect(readdirSync(join(user, "globalStorage"))).toEqual(names);
    expect(network).not.toHaveBeenCalled();
  });

  it("bounds text, skips internal and tool-only bubbles, and redacts through shared ingest", async () => {
    const db = fixture();
    put(db, "cursorDiskKV", "bubbleId:composer-1:tool", { type: 3, text: "tool-only-sentinel", code: "x".repeat(20000) });
    put(db, "cursorDiskKV", "bubbleId:composer-1:empty", { type: 2, toolFormerData: { result: "internal-sentinel" } });
    put(db, "cursorDiskKV", "bubbleId:composer-1:long", { type: 2, text: "x".repeat(20000), codeBlocks: [{ content: "code-sentinel" }] });
    put(db, "cursorDiskKV", "bubbleId:composer-1:secret", { type: 1, text: "password=super-secret-value" });
    expect(await sweep()).toMatchObject({ errors: 0 });
    expect(events()).toHaveLength(4);
    expect(events().map(event => JSON.parse(event.payload_json).text.length)).toContain(4000);
    expect(JSON.stringify([events(), memories()])).not.toMatch(/tool-only-sentinel|internal-sentinel|code-sentinel|super-secret-value/);
  });

  it("supports legacy workspace indexes without a global ItemTable and accepts SQLite BLOB values", async () => {
    const db = fixture("legacy");
    db.exec("DROP TABLE ItemTable");
    db.prepare("UPDATE cursorDiskKV SET value = ? WHERE key = ?").run(
      Buffer.from(JSON.stringify({ type: 1, text: "Read the original workspace." })), "bubbleId:composer-1:z-user",
    );
    expect(await sweep()).toMatchObject({ sessionsImported: 1, errors: 0 });
    expect(JSON.parse(events()[0].payload_json).text).toBe("Read the original workspace.");
  });

  it("reads live WAL commits on each watch sweep, preserves bubble identity during streaming, and checkpoints each composer", async () => {
    const db = fixture();
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    put(db, "ItemTable", "composer.composerHeaders", [
      { composerId: "composer-1", workspaceIdentifier: { uri: { fsPath: cwd } } },
      { composerId: "composer-2", workspaceIdentifier: { uri: { fsPath: cwd } } },
    ]);
    put(db, "cursorDiskKV", "composerData:composer-2", {});
    put(db, "cursorDiskKV", "bubbleId:composer-2:user", { type: 1, text: "Document the storage policy." });
    const sourceNames = readdirSync(join(user, "globalStorage"));
    const sourceFiles = sourceNames.map(name => readFileSync(join(user, "globalStorage", name)));
    await watchCommand({ once: true, host: "cursor", transcriptsDir: path }, context);
    expect(events()).toHaveLength(2);
    expect(events("composer-2")).toHaveLength(1);
    for (const [index, name] of sourceNames.entries()) expect(readFileSync(join(user, "globalStorage", name))).toEqual(sourceFiles[index]);
    const ids = events().map(event => event.id);
    const positions = events().map(event => event.event_index);
    const checkpointBefore = context.db.prepare("SELECT * FROM transcript_checkpoints ORDER BY path").all();
    expect(checkpointBefore).toHaveLength(2);
    // Settings changes and uncommitted bubbles do not trigger an import.
    put(db, "ItemTable", "unrelated-setting", { changed: true });
    db.exec("BEGIN");
    put(db, "cursorDiskKV", "bubbleId:composer-1:pending", { type: 2, text: "Uncommitted text" });
    expect(await sweep()).toMatchObject({ skipped: 2, sessionsImported: 0, errors: 0 });
    db.exec("ROLLBACK");
    put(db, "cursorDiskKV", "bubbleId:composer-1:a-assistant", { type: 2, text: "Finished the database migration.", createdAt: "2026-10-17T10:00:01.000Z" });
    put(db, "cursorDiskKV", "bubbleId:composer-1:next", { type: 1, text: "Run the migration tests." });
    expect(await sweep()).toMatchObject({ sessionsImported: 1, memoriesCreated: 0, skipped: 1, errors: 0 });
    expect(events()).toHaveLength(3);
    expect(events().slice(0, 2).map(event => event.id)).toEqual(ids);
    expect(events().slice(0, 2).map(event => event.event_index)).toEqual(positions);
    expect(JSON.parse(events()[1].payload_json).text).toBe("Finished the database migration.");
    expect(memories()).toHaveLength(2);
    context.db.close();
    context = createCliContext({ dbPath: join(dir, "memories.db") });
    expect(await sweep()).toMatchObject({ sessionsImported: 0, skipped: 2 });
    context.db.prepare("DELETE FROM transcript_checkpoints").run();
    expect(await sweep()).toMatchObject({ sessionsImported: 2, memoriesCreated: 0, errors: 0 });
    expect(events()).toHaveLength(3);
    // A WAL checkpoint/restart must not hide the next commit.
    db.pragma("wal_checkpoint(TRUNCATE)");
    put(db, "cursorDiskKV", "bubbleId:composer-1:last", { type: 2, text: "All tests passed." });
    expect(await sweep()).toMatchObject({ sessionsImported: 1, skipped: 1, errors: 0 });
    expect(events()).toHaveLength(4);
  });

  it("uses workspace paths for project isolation and handles central headers alongside legacy indexes", async () => {
    const db = fixture("legacy");
    const other = join(dir, "other-project");
    mkdirSync(other);
    put(db, "ItemTable", "composer.composerHeaders", { allComposers: [{ composerId: "composer-2", workspaceIdentifier: { uri: { fsPath: other } } }] });
    put(db, "cursorDiskKV", "composerData:composer-2", {});
    put(db, "cursorDiskKV", "bubbleId:composer-2:user", { type: 1, text: "Use a separate project." });
    expect(await sweep()).toMatchObject({ sessionsImported: 2, errors: 0 });
    expect(memories()).toHaveLength(1);
    expect(listMemoriesByProject(context.db, deriveProjectId(other))).toHaveLength(1);
  });

  it.each(["ItemTable", "cursorDiskKV", "index", "metadata", "bubble", "workspace", "text"])("reports missing or invalid %s as unsupported without checkpointing", async kind => {
    const db = fixture();
    if (["ItemTable", "cursorDiskKV"].includes(kind)) db.exec(`DROP TABLE ${kind}`);
    if (kind === "index") db.prepare("DELETE FROM ItemTable").run();
    if (kind === "metadata") db.prepare("DELETE FROM cursorDiskKV WHERE key LIKE 'composerData:%'").run();
    if (kind === "bubble") db.prepare("DELETE FROM cursorDiskKV WHERE key LIKE '%:z-user'").run();
    if (kind === "workspace") put(db, "ItemTable", "composer.composerHeaders", [{ composerId: "composer-1" }]);
    if (kind === "text") put(db, "cursorDiskKV", "bubbleId:composer-1:z-user", { type: 1, text: { unexpected: "shape" } });
    const diagnostic = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await sweep()).toMatchObject({ errors: 1, sessionsImported: 0 });
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("unsupported format for cursor"));
    expect(context.db.prepare("SELECT * FROM transcript_checkpoints").all()).toEqual([]);
    expect(memories()).toHaveLength(0);
  });

  it("retries a failed summary and deduplicates already captured events", async () => {
    fixture();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const call = context.service.call.bind(context.service);
    const failure = vi.spyOn(context.service, "call").mockImplementation(async (method, request) => {
      if (method === "handleSessionEnd") throw new Error("summary unavailable");
      return call(method, request);
    });
    expect(await sweep()).toMatchObject({ errors: 1, memoriesCreated: 0 });
    expect(events()).toHaveLength(2);
    failure.mockRestore();
    expect(await sweep()).toMatchObject({ errors: 0, memoriesCreated: 1 });
    expect(events()).toHaveLength(2);
  });

  it("discovers all three hosts by default and supports Cursor overrides without --host", async () => {
    fixture().close();
    for (const host of ["claude-code", "codex"] as const) {
      const directory = transcriptSources({ host })[0].directory;
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "session.jsonl"), JSON.stringify(host === "codex"
        ? { timestamp: "2026-10-17T10:00:00.000Z", type: "session_meta", payload: { id: "codex", cwd } }
        : { type: "user", sessionId: "claude", cwd, message: { content: "Use local storage." } }) + "\n"
        + (host === "codex" ? JSON.stringify({ timestamp: "2026-10-17T10:00:01.000Z", type: "response_item", payload: {
          type: "message", id: "u", role: "user", content: [{ type: "input_text", text: "Document local storage." }],
        } }) + "\n" : ""));
    }
    expect(await sweepTranscripts(context)).toMatchObject({ filesFound: 3, sessionsImported: 3, errors: 0 });
    expect(memories().map(memory => memory.source_adapter).sort()).toEqual(["claude-code", "codex", "cursor"]);
    expect(await sweepTranscripts(context, { transcriptsDir: user })).toMatchObject({ sessionsImported: 0, skipped: 1 });
    expect(await sweepTranscripts(context, { transcriptsDir: path })).toMatchObject({ sessionsImported: 0, skipped: 1 });
  });

  it("checks Cursor discovery without ingesting and reports incompatible schemas", async () => {
    expect(await inspectTranscriptDiscovery("cursor")).toContain("No transcripts found");
    const db = fixture();
    expect(await inspectTranscriptDiscovery("cursor")).toContain("1 composer(s) found");
    expect(events()).toEqual([]);
    expect(context.db.prepare("SELECT * FROM transcript_checkpoints").all()).toEqual([]);
    db.exec("DROP TABLE cursorDiskKV");
    await expect(inspectTranscriptDiscovery("cursor")).rejects.toThrow("unsupported format for cursor: missing cursorDiskKV");
  });

  it("resolves the supported OS paths and empty composer indexes", async () => {
    expect(cursorUserDirectory("darwin")).toBe(join(homedir(), "Library", "Application Support", "Cursor", "User"));
    expect(cursorUserDirectory("linux")).toBe(join(homedir(), ".config", "Cursor", "User"));
    expect(cursorUserDirectory("win32")).toBe(join(dir, "Cursor", "User"));
    const db = fixture();
    put(db, "ItemTable", "composer.composerHeaders", []);
    expect(await readCursorTranscripts(path)).toEqual([]);
    expect(await sweep()).toMatchObject({ filesFound: 1, sessionsImported: 0, errors: 0 });
  });

  it("dispatches scan --host cursor and watch --once through the real CLI", async () => {
    fixture("legacy").close();
    const cli = join(process.cwd(), "dist/cli/index.js");
    const env = { ...process.env, SESSIONMEM_DB_PATH: context.dbPath };
    const scan = await execFileAsync(process.execPath, [cli, "scan", "--host", "cursor", "--transcripts-dir", user], { env });
    expect(scan.stdout).toContain("memories created: 1");
    const watch = await execFileAsync(process.execPath, [cli, "watch", "--once", "--host", "cursor", "--transcripts-dir", path], { env });
    expect(watch.stderr).toBe("");
    expect(watch.stdout).toContain("sessions imported: 0; memories created: 0; skipped: 1");
    expect(events()).toHaveLength(2);
  });
});
