import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cli = join(process.cwd(), "dist/cli/index.js");
const preload = join(process.cwd(), "scripts/lib/autostart-test-preload.cjs");
const decision = "We decided to use SQLite for the ledger database.";

// The OS supervisor is simulated; install, watcher ingestion, hooks, MCP and storage are real.
describe("fresh install automatic memory flow", () => {
  let home: string, project: string, env: NodeJS.ProcessEnv;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sessionmem-auto-flow-"));
    project = join(home, "project"); mkdirSync(project);
    const bin = join(home, "bin"); mkdirSync(bin);
    env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home,
      PATH: bin + delimiter + process.env.PATH,
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}` };
    for (const key of ["SESSIONMEM_PROJECT_ID", "SESSIONMEM_DB_PATH", "SESSIONMEM_ADAPTER", "SESSIONMEM_DIAGNOSTIC_PROBE"]) delete env[key];
    if (process.platform === "win32") writeFileSync(join(bin, "sessionmem.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`);
    else {
      const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
      writeFileSync(join(bin, "sessionmem"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`);
      chmodSync(join(bin, "sessionmem"), 0o755);
    }
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  function run(args: string[], input?: unknown) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: "utf8", input: input ? JSON.stringify(input) : undefined, timeout: 20000 });
    expect(result.status, result.stdout + result.stderr + String(result.error ?? "")).toBe(0);
    return result.stdout;
  }
  function hook(event: string, payload: unknown) {
    const settings = JSON.parse(readFileSync(join(home, ".claude/settings.json"), "utf8"));
    const command = settings.hooks[event][0].hooks[0].command;
    const result = process.platform === "win32"
      ? spawnSync("cmd", ["/c", command], { env, cwd: project, encoding: "utf8", input: JSON.stringify(payload), timeout: 20000 })
      : spawnSync("/bin/sh", ["-c", command], { env, cwd: project, encoding: "utf8", input: JSON.stringify(payload), timeout: 20000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
  }
  it("captures installed tool hooks, ends a session, then injects at a new session and prompt", () => {
    run(["install", "--adapter", "claude-code"]);
    for (let i = 0; i < 3; i++) hook("PostToolUse", { session_id: "first", cwd: project, tool_name: "Bash",
      tool_input: { command: i === 0 ? 'git commit -m "Use SQLite for the ledger database"' : `npm run check${i}` } });
    hook("SessionEnd", { session_id: "first", cwd: project });
    const startup = JSON.parse(hook("SessionStart", { session_id: "second", cwd: project }));
    expect(startup.hookSpecificOutput.additionalContext).toContain("SQLite");
    const prompt = JSON.parse(hook("UserPromptSubmit", { session_id: "second", cwd: project, prompt: "Which ledger database did we choose?" }));
    expect(prompt.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(prompt.hookSpecificOutput.additionalContext).toContain("SQLite");
    const diagnostics = run(["doctor", "--adapter", "claude-code"]);
    expect(diagnostics).toContain("PASS Claude Code automatic capture");
    expect(diagnostics).toContain("PASS Claude Code automatic recall");
  }, 60000);

  it.each(["codex", "cursor"])("imports %s transcripts on install and supplies recall through the installed agent flow", async host => {
    if (host === "codex") {
      const path = join(home, ".codex/sessions/2026/10/19/rollout.jsonl"); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, [
        { timestamp: "2026-10-19T10:00:00Z", type: "session_meta", payload: { id: "first", cwd: project } },
        { timestamp: "2026-10-19T10:01:00Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: decision }] } },
      ].map(value => JSON.stringify(value)).join("\n") + "\n");
    } else {
      const user = process.platform === "darwin" ? join(home, "Library/Application Support/Cursor/User")
        : process.platform === "win32" ? join(home, "Cursor/User") : join(home, ".config/Cursor/User");
      const path = join(user, "globalStorage/state.vscdb"); mkdirSync(dirname(path), { recursive: true });
      const db = new BetterSqlite3(path);
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB); CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
      db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run("composer.composerHeaders", JSON.stringify([{ composerId: "first", workspaceIdentifier: { uri: { fsPath: project } } }]));
      db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run("composerData:first", "{}");
      db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run("bubbleId:first:user", JSON.stringify({ type: 1, text: decision }));
      db.close();
    }
    run(["install", "--adapter", host]);
    const guidancePath = host === "codex" ? join(home, ".codex/AGENTS.md") : join(project, ".cursor/rules/sessionmem.mdc");
    const instructions = readFileSync(guidancePath, "utf8");
    expect(instructions).toContain("Before work in a new session");
    expect(instructions).toContain("searchMemoryIndex");
    expect(instructions).toContain("Save significant decisions");
    if (host === "cursor") expect(instructions).toContain("alwaysApply: true");
    const diagnostics = run(["doctor", "--adapter", host]);
    expect(diagnostics).toContain(`PASS ${host === "codex" ? "Codex" : "Cursor"} automatic capture`);
    expect(diagnostics).toContain("Instruction-driven startup and prompt recall configured");
    const client = new Client({ name: "simulated-new-agent-session", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "run"], cwd: project,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")), stderr: "ignore" });
    try {
      await client.connect(transport);
      expect(client.getInstructions()).toContain("Before work in a new session");
      // Simulate the agent following its installed rule; no operator import or recall command.
      const search = await client.callTool({ name: "searchMemoryIndex", arguments: { query: "ledger database decision", limit: 5 } });
      const index = JSON.parse((search.content as Array<{ text: string }>)[0].text);
      expect(index.memories.length).toBeGreaterThan(0);
      const context: string[] = [];
      for (const row of index.memories) {
        const detail = await client.callTool({ name: "getMemory", arguments: { memoryId: row.id } });
        context.push(JSON.parse((detail.content as Array<{ text: string }>)[0].text).memory.content);
      }
      expect(context.join("\n").toLowerCase()).toContain("sqlite");
    } finally { await client.close(); }
  }, 60000);
});
