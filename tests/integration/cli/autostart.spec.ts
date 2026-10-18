import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { inspectWatchCheckpoint, watchCheckpointPath } from "../../../src/cli/watchCheckpoint.js";

const cli = join(process.cwd(), "dist/cli/index.js");
const supervisor = join(process.cwd(), "scripts/lib/autostart-test-preload.cjs");
let home: string;
let dbPath: string;
let env: NodeJS.ProcessEnv;
let transcript: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sessionmem-autostart-"));
  dbPath = join(home, "data & space", "memories.db");
  env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_ADAPTER: "claude-code", SESSIONMEM_PROJECT_ID: "autostart-test", NODE_OPTIONS: `--require ${JSON.stringify(supervisor)}` };
  const bin = join(home, "bin");
  mkdirSync(bin);
  if (process.platform === "win32") {
    writeFileSync(join(bin, "sessionmem.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`);
  } else {
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    writeFileSync(join(bin, "sessionmem"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`);
    chmodSync(join(bin, "sessionmem"), 0o755);
  }
  env.PATH = bin + delimiter + (process.env.PATH ?? "");
  const root = join(home, ".codex", "sessions");
  mkdirSync(root, { recursive: true });
  transcript = join(root, "rollout.jsonl");
  writeFileSync(transcript, [
    { type: "session_meta", payload: { id: "automatic-session", cwd: home, source: "cli" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Use SQLite for local storage." }] } },
  ].map(x => JSON.stringify({ timestamp: "2026-10-18T00:00:00.000Z", ...x })).join("\n") + "\n");
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });
function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8", cwd: home, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new Error(`sessionmem ${args.join(" ")} failed: ${result.error.message}`, { cause: result.error });
  return result;
}
function checkpoint() { return JSON.parse(readFileSync(watchCheckpointPath(dbPath), "utf8")); }
function install() {
  const result = run("install");
  expect(result.status, result.stdout + result.stderr).toBe(0);
}

describe("login capture CLI (native scheduler mocked)", () => {
  it("captures Codex at install, updates in place, diagnoses capture and removes registration without deleting memories", () => {
    install();
    expect(checkpoint()).toMatchObject({ summary: { sessionsImported: 1, errors: 0 }, checkpointCount: 1 });
    expect(run("autostart", "status").stdout).toContain("Auto-start enabled");
    install();
    expect(checkpoint()).toMatchObject({ summary: { sessionsImported: 0, skipped: 1, errors: 0 }, checkpointCount: 1 });
    const doctor = run("doctor");
    expect(doctor.status, doctor.stdout + doctor.stderr).toBe(0);
    expect(doctor.stdout).toContain("PASS Watcher capture");
    const before = new BetterSqlite3(dbPath);
    const memories = before.prepare("SELECT count(*) AS n FROM memories").get();
    before.close();
    const uninstall = run("uninstall");
    expect(uninstall.status, uninstall.stderr).toBe(0);
    expect(run("autostart", "status").stdout).toContain("Auto-start disabled");
    expect(existsSync(dbPath)).toBe(true);
    const after = new BetterSqlite3(dbPath);
    expect(after.prepare("SELECT count(*) AS n FROM memories").get()).toEqual(memories);
    after.close();
  });
  // Each CLI boot loads storage; install/enable also run a real watcher sweep,
  // and doctor starts an MCP child. Keep these cases independent so Windows
  // startup costs do not exhaust one test's 20-second budget.
  it("rejects unknown actions before changing registration", () => {
    install();
    const before = checkpoint();
    const invalid = run("autostart", "invalid");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Use sessionmem autostart enable, disable, or status");
    expect(run("autostart", "status").stdout).toContain("enabled");
    expect(checkpoint()).toEqual(before);
  });
  it("disables capture idempotently and reports the missing registration", () => {
    install();
    expect(run("autostart", "disable").status).toBe(0);
    expect(run("autostart", "disable").status).toBe(0);
    const doctor = run("doctor");
    expect(doctor.status).toBe(1);
    expect(doctor.stdout).toContain("FAIL Auto-start registration");
  });
  it("re-enables capture after disable and imports newly appended events", () => {
    install();
    expect(run("autostart", "disable").status).toBe(0);
    appendFileSync(transcript, JSON.stringify({
      timestamp: "2026-10-18T00:01:00.000Z", type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Use TypeScript for this project." }] },
    }) + "\n");
    expect(run("autostart", "enable").status).toBe(0);
    expect(run("autostart", "status").stdout).toContain("enabled");
    expect(checkpoint()).toMatchObject({ summary: { sessionsImported: 1, memoriesCreated: 0, errors: 0 }, checkpointCount: 1 });
    const db = new BetterSqlite3(dbPath, { readonly: true });
    try {
      expect(db.prepare("SELECT count(*) AS n FROM session_events WHERE session_id = ?").get("automatic-session")).toEqual({ n: 2 });
    } finally { db.close(); }
  });
  it("diagnoses stale checkpoints and points to enable and capture logs", () => {
    install();
    const value = checkpoint();
    value.completedAt = "2000-01-01T00:00:00.000Z";
    writeFileSync(watchCheckpointPath(dbPath), JSON.stringify(value));
    const doctor = run("doctor");
    expect(doctor.status).toBe(1);
    expect(doctor.stdout).toContain("FAIL Watcher capture: Watcher checkpoint is stale");
    expect(doctor.stdout).toContain("sessionmem autostart enable");
    expect(doctor.stdout).toContain("logs/watch.log");
  });
  it("diagnoses a removed registered executable and repairs it in place", () => {
    install();
    const file = process.platform === "darwin" ? join(home, "Library/LaunchAgents/io.sessionmem.watch.plist")
      : process.platform === "win32" ? join(home, "autostart-test-state.json") : join(home, ".config/systemd/user/sessionmem-watch.service");
    const missing = process.platform === "win32" ? "C:\\missing\\node.exe" : "/missing/node";
    if (process.platform === "win32") {
      const state = JSON.parse(readFileSync(file, "utf8"));
      state.xml = state.xml.replace(/<Command>.*?<\/Command>/, `<Command>${missing}</Command>`);
      writeFileSync(file, JSON.stringify(state));
    } else {
      writeFileSync(file, readFileSync(file, "utf8").replace(process.execPath, missing));
    }
    const doctor = run("doctor");
    expect(doctor.status).toBe(1);
    expect(doctor.stdout).toContain("FAIL Auto-start binary");
    expect(doctor.stdout).toContain("sessionmem autostart enable");
    expect(run("autostart", "enable").status).toBe(0);
    expect(run("doctor").status).toBe(0);
  });
  it("logs malformed transcript failures without a TTY and refuses to call the sweep healthy", () => {
    appendFileSync(transcript, "broken JSON\n");
    const log = join(home, "watch.log");
    const result = run("watch", "--once", "--log-file", log);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const content = readFileSync(log, "utf8");
    expect(content).toMatch(/\d{4}-\d\d-\d\dT.+sessionmem watch starting/);
    expect(content).toContain("malformed or incomplete JSONL");
    expect(content).toContain("sessionmem watch stopped");
    expect(() => inspectWatchCheckpoint(dbPath)).toThrow(/capture error/);
  });
  it("logs storage initialization failures headlessly", () => {
    mkdirSync(join(home, "blocked-db"));
    const log = join(home, "failure.log");
    const result = run("watch", "--once", "--db-path", join(home, "blocked-db"), "--log-file", log);
    expect(result.status).toBe(1);
    expect(readFileSync(log, "utf8")).toContain("watch failed:");
    expect(existsSync(watchCheckpointPath(join(home, "blocked-db")))).toBe(false);
  });
  it("runs the registered command with no shell PATH", () => {
    install();
    env.PATH = "";
    const result = run("autostart", "enable");
    expect(result.status, result.stderr).toBe(0);
    expect(checkpoint().summary.errors).toBe(0);
  });
});
