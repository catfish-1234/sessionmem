import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

const cli = join(process.cwd(), "dist", "cli", "index.js");

describe("offline setup and doctor CLI", () => {
  let home: string;
  let bin: string;
  let dbPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sessionmem-doctor-"));
    bin = join(home, "bin");
    dbPath = join(home, ".sessionmem", "memories.db");
    mkdirSync(bin);
    // Block and record networking in both the CLI and its MCP child process.
    const guard = join(home, "offline.cjs");
    writeFileSync(guard, readFileSync(join(process.cwd(), "scripts/lib/autostart-test-preload.cjs"), "utf8") + `
      const deny = () => {
        require('node:fs').writeFileSync(${JSON.stringify(join(home, "network-attempt"))}, 'attempted');
        throw new Error('Network access forbidden by offline test');
      };
      globalThis.fetch = deny;
      require('node:http').request = deny;
      require('node:https').request = deny;
      require('node:net').Socket.prototype.connect = deny;
      require('node:dns').lookup = deny;
    `);
    env = {
      ...process.env,
      HOME: home, USERPROFILE: home, APPDATA: home,
      PATH: bin + delimiter + (process.env.PATH ?? ""),
      SESSIONMEM_DB_PATH: dbPath,
      SESSIONMEM_ADAPTER: "",
      SESSIONMEM_PROJECT_ID: "doctor-test-project",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(guard)}`,
    };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION_ID;
    if (process.platform === "win32") {
      writeFileSync(join(bin, "sessionmem.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`);
      writeFileSync(join(bin, "claude.cmd"), "@exit /b 99\r\n");
    } else {
      const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
      writeFileSync(join(bin, "sessionmem"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`);
      writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 99\n");
      chmodSync(join(bin, "sessionmem"), 0o755);
      chmodSync(join(bin, "claude"), 0o755);
    }
  });

  afterEach(() => {
    const networkAttempted = existsSync(join(home, "network-attempt"));
    rmSync(home, { recursive: true, force: true });
    expect(networkAttempted).toBe(false);
  });

  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env, cwd: home, encoding: "utf8", timeout: 20000 });
    if (result.error) throw result.error;
    return result;
  }

  function install() {
    const result = run("install");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result;
  }

  function settings() {
    return JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  }

  function saveSettings(value: unknown) {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(value));
  }

  it("detects Claude from a plain terminal, configures hooks, and passes every diagnostic offline", async () => {
    expect(install().stdout).toContain("Detected host: Claude Code");
    const hooks = settings().hooks;
    expect(Object.keys(hooks)).toEqual(["SessionStart", "SessionEnd", "PostToolUse"]);
    // A pre-existing user memory must survive the canary unchanged.
    const db = openDb({ dbPath });
    const service = createMemoryCoreService({ db });
    await service.storeMemory({ projectId: "doctor-test-project", sessionId: "session", memoryId: "real-memory", sourceAdapter: "test", kind: "fact", content: "Keep the user's memory intact.", importance: 7 });
    const before = db.prepare("SELECT * FROM memories").all();
    db.close();

    const result = run("doctor");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.match(/^PASS /gm)).toHaveLength(11);
    expect(result.stdout).toContain("Claude Code adapter wiring");
    expect(result.stdout).toContain("canary rolled back");
    const after = new BetterSqlite3(dbPath);
    expect(after.prepare("SELECT * FROM memories").all()).toEqual(before);
    expect(after.prepare("SELECT * FROM memory_feedback").all()).toEqual([]);
    expect(after.prepare("SELECT * FROM session_events").all()).toEqual([]);
    expect(after.prepare("SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH 'canary'").get()).toEqual({ n: 0 });
    after.close();
    // A second run must also leave no diagnostic rows behind.
    expect(run("doctor").status).toBe(0);
  });

  it("does not create a missing memory store and reports storage, host, and discovery checks", () => {
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout.match(/^FAIL /gm)).toHaveLength(8);
    expect(result.stdout.match(/^PASS .* transcripts:/gm)).toHaveLength(3);
    expect(result.stdout).toContain("sessionmem ping");
    expect(existsSync(dbPath)).toBe(false);
  });

  it("reports corrupt databases without replacing them", () => {
    mkdirSync(join(home, ".sessionmem"));
    writeFileSync(dbPath, "invalid sqlite data");
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Memory store");
    expect(result.stdout).toContain("FAIL Schema");
    expect(readFileSync(dbPath, "utf8")).toBe("invalid sqlite data");
  });

  it("reports pending migrations without applying them and gives a working offline repair command", () => {
    install();
    // An unapplied migration from the previous release.
    const db = new BetterSqlite3(dbPath);
    db.exec("ALTER TABLE memories DROP COLUMN expires_at; DELETE FROM _migrations WHERE name = '011_memory_expiry.sql'");
    db.close();
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Schema: Pending migrations: 011_memory_expiry.sql");
    expect(result.stdout).toContain("Fix: sessionmem ping");
    expect(result.stdout).toContain("FAIL Recall canary: Blocked");
    const unchanged = new BetterSqlite3(dbPath);
    expect(unchanged.prepare("SELECT name FROM _migrations WHERE name = '011_memory_expiry.sql'").get()).toBeUndefined();
    unchanged.close();
    expect(run("ping").status).toBe(0);
    expect(run("doctor").status).toBe(0);
  });

  it("fails on a future schema instead of suggesting a downgrade", () => {
    install();
    const db = new BetterSqlite3(dbPath);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("999_future.sql");
    db.close();
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unrecognized migrations: 999_future.sql");
    expect(result.stdout).toContain("do not downgrade");
  });

  it.each(["missing", "matcher", "type", "duplicate", "async", "stale"])("reports and repairs %s hook configuration", (problem) => {
    install();
    const config = settings();
    const entry = config.hooks.PostToolUse[0];
    if (problem === "missing") delete config.hooks.PostToolUse;
    if (problem === "matcher") entry.matcher = "WrongTool";
    if (problem === "type") entry.hooks[0].type = "prompt";
    if (problem === "duplicate") config.hooks.PostToolUse.push(structuredClone(entry));
    if (problem === "async") entry.hooks[0].async = true;
    if (problem === "stale") entry.hooks[0].command += " --old";
    saveSettings(config);
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Claude Code hooks");
    expect(result.stdout).toContain("sessionmem install --adapter claude-code");
    expect(run("install", "--adapter", "claude-code").status).toBe(0);
    expect(run("doctor").status).toBe(0);
  });

  it("reports globally disabled hooks with an actionable hint", () => {
    install();
    const config = settings();
    config.disableAllHooks = true;
    saveSettings(config);
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("disableAllHooks enabled");
    expect(result.stdout).toContain("Enable hooks in the host settings");
  });

  it.each(["missing", "malformed", "stale"])("reports %s MCP configuration", (problem) => {
    install();
    const path = join(home, ".claude.json");
    writeFileSync(path, problem === "malformed" ? "{" : JSON.stringify({ mcpServers: problem === "missing" ? {} : { sessionmem: { command: "wrong-sessionmem", args: ["run"] } } }));
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Claude Code adapter wiring");
    expect(result.stdout).toContain("sessionmem install --adapter claude-code");
    expect(result.stdout).toContain("PASS Recall canary");
  });

  it("fails adapter wiring when the registered executable cannot start", () => {
    install();
    rmSync(join(bin, process.platform === "win32" ? "sessionmem.cmd" : "sessionmem"));
    env.PATH = bin;
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Claude Code adapter wiring");
    expect(result.stdout).toContain("Ensure sessionmem is on PATH");
    expect(result.stdout).toContain("PASS Recall canary");
  });

  it("rejects an older server found on PATH", () => {
    install();
    const server = join(home, "old-server.cjs");
    writeFileSync(server, `
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\\n')) !== -1) {
          const request = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (request.method === 'initialize') process.stdout.write(JSON.stringify({
            jsonrpc: '2.0', id: request.id, result: {
              protocolVersion: request.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'sessionmem', version: '0.0.0' }
            }
          }) + '\\n');
        }
      });
    `);
    if (process.platform === "win32") {
      writeFileSync(join(bin, "sessionmem.cmd"), `@"${process.execPath}" "${server}" %*\r\n`);
    } else {
      writeFileSync(join(bin, "sessionmem"), `#!/bin/sh\nexec "${process.execPath}" "${server}" "$@"\n`);
    }
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("MCP server version does not match");
    expect(result.stdout).toContain("PASS Recall canary");
  });

  it("accepts equivalent database paths in host configuration and refuses a different store", () => {
    install();
    const path = join(home, ".claude.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.mcpServers.sessionmem.env = { SESSIONMEM_DB_PATH: "~/.sessionmem/memories.db" };
    writeFileSync(path, JSON.stringify(config));
    const equivalent = run("doctor");
    expect(equivalent.status, equivalent.stdout + equivalent.stderr).toBe(0);
    config.mcpServers.sessionmem.env.SESSIONMEM_DB_PATH = join(home, "other.db");
    writeFileSync(path, JSON.stringify(config));
    const different = run("doctor");
    expect(different.status).toBe(1);
    expect(different.stdout).toContain("different SESSIONMEM_DB_PATH");
    expect(existsSync(join(home, "other.db"))).toBe(false);
  });

  it.each(["codex", "cursor", "windsurf", "cline", "generic"])("supports diagnostics for an explicitly selected %s adapter", (adapter) => {
    const installed = run("install", "--adapter", adapter);
    expect(installed.status, installed.stdout + installed.stderr).toBe(0);
    const result = run("doctor", "--adapter", adapter);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.match(/^PASS /gm)).toHaveLength(11);
    expect(result.stdout).toContain("no lifecycle hooks are required");
  });

  it("discovers dated Codex rollouts and reports unsupported formats without writing imports", () => {
    install();
    const directory = join(home, ".codex", "sessions", "2026", "10", "17");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "rollout-2026-10-17T10-00-00-session.jsonl");
    writeFileSync(path, JSON.stringify({
      timestamp: "2026-10-17T10:00:00.000Z", type: "session_meta", payload: { id: "codex-session", cwd: home },
    }) + "\n");
    const result = run("doctor");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS codex transcripts: 1 transcript file(s) found");
    expect(result.stdout).toContain("sample parsed as codex");
    const db = new BetterSqlite3(dbPath);
    expect(db.prepare("SELECT * FROM transcript_checkpoints").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM session_events").all()).toEqual([]);
    db.close();
    writeFileSync(path, '{"type":"user","message":{"content":"Wrong host"}}\n');
    const invalid = run("doctor");
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain("FAIL codex transcripts: unsupported format for codex");
  });

  it("checks Cursor transcript discovery and reports unsupported SQLite schemas without importing", () => {
    install();
    const user = process.platform === "darwin" ? join(home, "Library", "Application Support", "Cursor", "User")
      : process.platform === "win32" ? join(home, "Cursor", "User") : join(home, ".config", "Cursor", "User");
    const directory = join(user, "globalStorage");
    mkdirSync(directory, { recursive: true });
    const source = new BetterSqlite3(join(directory, "state.vscdb"));
    source.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB); CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    source.prepare("INSERT INTO ItemTable VALUES (?, ?)").run("composer.composerHeaders", JSON.stringify([
      { composerId: "cursor-composer", workspaceIdentifier: { uri: { fsPath: home } } },
    ]));
    source.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run("composerData:cursor-composer", "{}");
    source.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run("bubbleId:cursor-composer:user", JSON.stringify({ type: 1, text: "Keep local history." }));
    source.close();
    const result = run("doctor");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS cursor transcripts: 1 composer(s) found");
    const store = new BetterSqlite3(dbPath);
    expect(store.prepare("SELECT * FROM transcript_checkpoints").all()).toEqual([]);
    expect(store.prepare("SELECT * FROM session_events").all()).toEqual([]);
    store.close();
    const broken = new BetterSqlite3(join(directory, "state.vscdb"));
    broken.exec("DROP TABLE cursorDiskKV");
    broken.close();
    const invalid = run("doctor");
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain("FAIL cursor transcripts: unsupported format for cursor: missing cursorDiskKV");
  });

  it("rolls back a canary after recall fails", () => {
    install();
    const db = new BetterSqlite3(dbPath);
    // Force successful storage followed by failed service retrieval.
    db.exec("CREATE TRIGGER expire_canary AFTER INSERT ON memories WHEN new.source_adapter = 'doctor' BEGIN UPDATE memories SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = new.id; END");
    db.close();
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Recall canary");
    const checked = new BetterSqlite3(dbPath);
    expect(checked.prepare("SELECT * FROM memories").all()).toEqual([]);
    expect(checked.prepare("SELECT * FROM memory_feedback").all()).toEqual([]);
    checked.close();
  });

  it("explicit override works without a detected host and invalid names fail before writing files", () => {
    rmSync(join(bin, process.platform === "win32" ? "claude.cmd" : "claude"));
    env.PATH = bin;
    const invalid = run("install", "--adapter", "invalid");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Unknown adapter");
    expect(existsSync(dbPath)).toBe(false);
    const absent = run("install");
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain("No supported agent host found");
    expect(existsSync(dbPath)).toBe(false);
    expect(run("install", "--adapter", "claude-code").status).toBe(0);
  });

  it("reports missing hosts without suppressing storage diagnostics", () => {
    install();
    rmSync(join(bin, process.platform === "win32" ? "claude.cmd" : "claude"));
    env.PATH = bin;
    const result = run("doctor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Agent hosts");
    expect(result.stdout).toContain("PASS Memory store");
    expect(result.stdout).toContain("PASS Recall canary");
    expect(result.stdout).toContain("FAIL Hook configuration");
  });
});
