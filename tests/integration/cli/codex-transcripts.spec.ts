import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliContext, type CliContext } from "../../../src/cli/context.js";
import { sweepTranscripts } from "../../../src/cli/transcriptSweep.js";
import { watchCommand } from "../../../src/cli/commands/watch.js";
import { deriveProjectId } from "../../../src/cli/projectId.js";
import { listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";
import { listSessionEventsBySession } from "../../../src/core/storage/sessionEventsRepo.js";

const execFileAsync = promisify(execFile);
const fixtureRoot = join(process.cwd(), "tests/fixtures/transcripts/codex");
const original = "2026/10/17/rollout-2026-10-17T10-00-00-original.jsonl";
const resumed = "2026/10/18/rollout-2026-10-18T10-00-00-resumed.jsonl";
const subagent = "2026/10/17/rollout-2026-10-17T10-01-00-subagent.jsonl";
const filtered = "2026/10/17/rollout-2026-10-17T10-02-00-filtered.jsonl";
const sessionId = "019a0000-0000-7000-8000-000000000001";
let dir: string;
let root: string;
let cwd: string;
let context: CliContext;
let projectId: string;
let dbPath: string;

function fixture(name: string): string {
  return readFileSync(join(fixtureRoot, name), "utf8").replaceAll("/projects/codex-demo", cwd.replaceAll("\\", "/"));
}

function put(name: string, text = fixture(name), directory = root): string {
  const path = join(directory, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function events(id = sessionId) { return listSessionEventsBySession(context.db, projectId, id); }
function memories() { return listMemoriesByProject(context.db, projectId); }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sessionmem-codex-transcripts-"));
  root = join(dir, "sessions");
  cwd = join(dir, "repo");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  dbPath = join(dir, "memories.db");
  vi.stubEnv("SESSIONMEM_PROJECT_ID", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
  context = createCliContext({ dbPath });
  projectId = deriveProjectId(cwd);
});

afterEach(() => {
  context.db.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  rmSync(dir, { recursive: true, force: true });
});

describe("Codex CLI transcript capture", () => {
  it("imports messages and native function calls with their call_id and project cwd", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    put(original);
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toEqual({
      filesFound: 1, sessionsImported: 1, memoriesCreated: 1, skipped: 0, errors: 0,
    });
    expect(events().map(event => event.event_type)).toEqual([
      "message:user", "message:assistant", "tool_use:exec_command", "message:assistant",
    ]);
    expect(JSON.parse(events()[2].payload_json)).toEqual({
      tool: "exec_command", text: "Ran: npm test", input: { cmd: "npm test", workdir: cwd.replaceAll("\\", "/") },
      cwd: cwd.replaceAll("\\", "/"), call_id: "call_test_1",
    });
    expect(events()[0].created_at).toBe("2026-10-17T10:00:01.000Z");
    expect(memories()[0]).toMatchObject({ session_id: sessionId, source_adapter: "codex" });
    expect(memories()[0].content.toLowerCase()).toContain("sqlite");
    expect(network).not.toHaveBeenCalled();
  });

  it("groups resumed files once per session and deduplicates replay after checkpoint loss", async () => {
    put(original);
    put(resumed);
    const call = vi.spyOn(context.service, "call");
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({
      filesFound: 2, sessionsImported: 1, memoriesCreated: 1, errors: 0,
    });
    expect(call.mock.calls.filter(([method]) => method === "handleSessionEnd")).toHaveLength(1);
    expect(events()).toHaveLength(6);
    const ids = events().map(event => event.id);
    context.db.prepare("DELETE FROM transcript_checkpoints").run();
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ memoriesCreated: 0, errors: 0 });
    expect(events().map(event => event.id)).toEqual(ids);
    expect(memories()).toHaveLength(1);
  });

  it("watch discovers a new dated resume file after restart without reimporting earlier items", async () => {
    put(original);
    await watchCommand({ once: true, transcriptsDir: root }, context);
    const id = memories()[0].id;
    context.db.close();
    context = createCliContext({ dbPath });
    put(resumed);
    await watchCommand({ once: true, transcriptsDir: root }, context);
    expect(events()).toHaveLength(6);
    expect(memories()).toHaveLength(1);
    expect(memories()[0].id).toBe(id);
    expect(memories()[0].content.toLowerCase()).toContain("storage policy");
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ skipped: 2, sessionsImported: 0 });
  });

  it("keeps sub-agent session_meta IDs separate from parent_thread_id", async () => {
    put(original);
    put(subagent);
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ sessionsImported: 2, errors: 0 });
    expect(events()).toHaveLength(4);
    expect(events("019a0000-0000-7000-8000-000000000002")).toHaveLength(2);
    expect(memories()).toHaveLength(2);
    expect(memories().every(memory => memory.source_adapter === "codex")).toBe(true);
  });

  it("excludes encrypted agent_message payloads and injected blocks while retaining human chunks", async () => {
    put(filtered);
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ sessionsImported: 1, errors: 0 });
    const captured = events("019a0000-0000-7000-8000-000000000003");
    expect(captured.map(event => JSON.parse(event.payload_json).text)).toEqual([
      "Please explain plugin discovery.", "Keep the local setup documented.", "Plugin discovery uses the local configuration.",
    ]);
    const stored = JSON.stringify([captured, memories()]);
    for (const text of ["gAAAAA", "machine-only-sentinel", "plugin-catalogue-sentinel", "private-machine-sentinel", "Internal machine instructions"]) {
      expect(stored).not.toContain(text);
    }
  });

  it("deduplicates messages without IDs across changed replay timestamps and preserves repeated human turns", async () => {
    const records = fixture(original).trim().split("\n").map(line => JSON.parse(line));
    for (const record of records) delete record.payload.id;
    // Keep session_meta's required ID; messages from some CLI versions omit IDs.
    records[0].payload.id = sessionId;
    const repeated = structuredClone(records[2]);
    repeated.timestamp = "2026-10-17T10:01:00.000Z";
    records.push(repeated);
    put(original, records.map(record => JSON.stringify(record)).join("\n") + "\n");
    await sweepTranscripts(context, { transcriptsDir: root });
    expect(events()).toHaveLength(5);
    for (const record of records) record.timestamp = "2026-10-18T10:00:00.000Z";
    put(resumed, records.map(record => JSON.stringify(record)).join("\n") + "\n");
    await sweepTranscripts(context, { transcriptsDir: root });
    expect(events()).toHaveLength(5);
  });

  it("retries an incomplete Codex append without duplicating valid earlier events", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const tail = JSON.stringify({ timestamp: "2026-10-18T10:00:00.000Z", type: "response_item", payload: {
      type: "message", id: "msg_tail", role: "assistant", content: [{ type: "output_text", text: "Completed the documentation." }],
    } }) + "\n";
    const path = put(original, fixture(original) + tail.slice(0, 40));
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ errors: 1, memoriesCreated: 1 });
    expect(events()).toHaveLength(4);
    appendFileSync(path, tail.slice(40));
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ errors: 0, memoriesCreated: 0 });
    expect(events()).toHaveLength(5);
  });

  it("retains human headings and bounds native function call arguments", async () => {
    const records = fixture(original).trim().split("\n").map(line => JSON.parse(line));
    records[2].payload.content[0].text = "# Plugins\nPlease explain how plugin discovery works.";
    records[4].payload.name = "write_file";
    records[4].payload.arguments = JSON.stringify({ path: "large.txt", content: "x".repeat(20000) });
    put(original, records.map(record => JSON.stringify(record)).join("\n") + "\n");
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ errors: 0 });
    expect(JSON.parse(events()[0].payload_json).text).toContain("Please explain");
    expect(events()[2].event_type).toBe("tool_use:write_file");
    expect(events()[2].payload_json.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(events()[2].payload_json)).toMatchObject({ tool: "write_file", call_id: "call_test_1" });
  });

  it("sweeps both histories by default without requiring host executables", async () => {
    put(original, fixture(original), join(dir, ".codex", "sessions"));
    put("project/claude.jsonl", JSON.stringify({ type: "user", sessionId: "claude-session", uuid: "u1", cwd,
      message: { content: "Use local storage." } }) + "\n", join(dir, ".claude", "projects"));
    expect(await sweepTranscripts(context)).toMatchObject({ filesFound: 2, sessionsImported: 2, errors: 0 });
    expect(memories().map(memory => memory.source_adapter).sort()).toEqual(["claude-code", "codex"]);
  });

  it.each(["codex", "claude-code"])("reports an unsupported format for a wrong %s host claim", async host => {
    const diagnostic = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    put(original, host === "codex"
      ? JSON.stringify({ type: "user", sessionId: "s", cwd, message: { content: "Wrong host" } }) + "\n"
      : fixture(original));
    expect(await sweepTranscripts(context, { transcriptsDir: root, host })).toMatchObject({ errors: 1, sessionsImported: 0 });
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(`unsupported format for ${host}`));
    expect(context.db.prepare("SELECT * FROM transcript_checkpoints").all()).toEqual([]);
    expect(memories()).toHaveLength(0);
  });

  it.each(["missing-meta", "bad-message", "bad-arguments", "unknown-record", "unknown-item"])("reports %s as unsupported and retries after repair", async kind => {
    const diagnostic = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const records = fixture(original).trim().split("\n").map(line => JSON.parse(line));
    if (kind === "missing-meta") records.shift();
    if (kind === "bad-message") records[2].payload.content = "Unexpected string";
    if (kind === "bad-arguments") records[4].payload.arguments = "not JSON";
    if (kind === "unknown-record") records[1].type = "unknown";
    if (kind === "unknown-item") records[2].payload.type = "unknown";
    put(original, records.map(record => JSON.stringify(record)).join("\n") + "\n");
    expect(await sweepTranscripts(context, { transcriptsDir: root, host: "codex" })).toMatchObject({ errors: 1, sessionsImported: 0 });
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("unsupported format for codex"));
    put(original);
    expect(await sweepTranscripts(context, { transcriptsDir: root, host: "codex" })).toMatchObject({ errors: 0, sessionsImported: 1 });
  });

  it("imports mixed host overrides and validates host selection before checkpoint reuse", async () => {
    put(original);
    put("claude.jsonl", JSON.stringify({ type: "user", sessionId: "claude", cwd, message: { content: "A human turn." } }) + "\n");
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ sessionsImported: 2, errors: 0 });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await sweepTranscripts(context, { transcriptsDir: root, host: "claude-code" })).toMatchObject({ errors: 1 });
    await expect(sweepTranscripts(context, { host: "unknown" })).rejects.toThrow("Unsupported transcript host");
  });

  it("dispatches scan and resumed watch through the real CLI", async () => {
    put(original);
    const cli = join(process.cwd(), "dist/cli/index.js");
    const env = { ...process.env, SESSIONMEM_DB_PATH: dbPath };
    const scan = await execFileAsync(process.execPath, [cli, "scan", "--transcripts-dir", root], { env });
    expect(scan.stdout).toContain("memories created: 1");
    put(resumed);
    const watch = await execFileAsync(process.execPath, [cli, "watch", "--once", "--host", "codex", "--transcripts-dir", root], { env });
    expect(watch.stderr).toBe("");
    expect(events()).toHaveLength(6);
    expect(memories()).toHaveLength(1);
  });
});
