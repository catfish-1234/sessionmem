import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliContext, type CliContext } from "../../../src/cli/context.js";
import { deriveProjectId } from "../../../src/cli/projectId.js";
import { scanCommand } from "../../../src/cli/commands/scan.js";
import { sweepTranscripts } from "../../../src/cli/transcriptSweep.js";
import { listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";
import { listSessionEventsBySession } from "../../../src/core/storage/sessionEventsRepo.js";
import { buildToolEvent } from "../../../src/core/capture/toolEvent.js";
import { listProjectKnowledge } from "../../../src/core/storage/knowledgeRepo.js";

const execFileAsync = promisify(execFile);
const cliPath = join(process.cwd(), "dist/cli/index.js");
let dir: string;
let root: string;
let cwd: string;
let dbPath: string;
let projectId: string;
let context: CliContext;

function record(sessionId: string, uuid: string, content: unknown, type = "assistant") {
  return JSON.stringify({ type, sessionId, uuid, cwd, message: { content } }) + "\n";
}

function transcript(sessionId = "session-1", text = "Use SQLite for local storage") {
  return record(sessionId, "user-1", text, "user") + record(sessionId, "assistant-1", [
    { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } },
    { type: "tool_use", id: "ignored-read", name: "Read", input: { file_path: "README.md" } },
    { type: "text", text: "All tests passed" },
  ]);
}

function memories() { return listMemoriesByProject(context.db, projectId); }
function events(sessionId = "session-1") { return listSessionEventsBySession(context.db, projectId, sessionId); }

beforeEach(() => {
  vi.stubEnv("SESSIONMEM_PROJECT_ID", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  dir = mkdtempSync(join(tmpdir(), "sessionmem-transcripts-"));
  root = join(dir, "projects");
  cwd = join(dir, "repo");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(join(root, "encoded-project"), { recursive: true });
  dbPath = join(dir, "memories.db");
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

describe("retroactive transcript capture", () => {
  it("imports through shared capture and stays idempotent across restarts and replay", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const path = join(root, "encoded-project", "session-1.jsonl");
    writeFileSync(path, transcript());
    writeFileSync(join(root, "encoded-project", "notes.json"), "{}");
    const first = await scanCommand({ transcriptsDir: root }, context);
    expect(first).toEqual({ filesFound: 1, sessionsImported: 1, memoriesCreated: 1, skipped: 0, errors: 0 });
    expect(memories()).toHaveLength(1);
    expect(memories()[0].content).toContain("use sqlite for local storage");
    expect(events()).toHaveLength(3);
    expect(listProjectKnowledge(context.db, projectId).relations).toContainEqual(expect.objectContaining({
      sourceName: "user", relation: "uses", targetName: "sqlite", memoryIds: [memories()[0].id],
    }));
    expect(events()[1].payload_json).toBe(buildToolEvent("Bash", { command: "npm test" }, cwd)?.payloadJson);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("files found: 1; sessions imported: 1; memories created: 1; skipped: 0"));

    context.db.close();
    context = createCliContext({ dbPath });
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ sessionsImported: 0, memoriesCreated: 0, skipped: 1 });
    // Replays after a lost checkpoint or interrupted process must also be safe.
    context.db.prepare("DELETE FROM transcript_checkpoints").run();
    await sweepTranscripts(context, { transcriptsDir: root });
    appendFileSync(path, "\n");
    await sweepTranscripts(context, { transcriptsDir: root });
    expect(memories()).toHaveLength(1);
    expect(events()).toHaveLength(3);
    writeFileSync(join(root, "encoded-project", "copy.jsonl"), transcript());
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ memoriesCreated: 0, errors: 0 });
    expect(memories()).toHaveLength(1);
    expect(events()).toHaveLength(3);
    expect(network).not.toHaveBeenCalled();
  });

  it("watch sweeps append to existing sessions and discover new nested directories", async () => {
    const path = join(root, "encoded-project", "session-1.jsonl");
    writeFileSync(path, transcript());
    await sweepTranscripts(context, { transcriptsDir: root });
    const id = memories()[0].id;
    appendFileSync(path, record("session-1", "assistant-2", "Added a migration"));
    const nested = join(root, "new-project", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "session-2.jsonl"), record("session-2", "user-1", "Document the storage policy", "user"));
    const next = await sweepTranscripts(context, { transcriptsDir: root });
    expect(next).toMatchObject({ filesFound: 2, sessionsImported: 2, memoriesCreated: 1, errors: 0 });
    expect(memories()).toHaveLength(2);
    expect(memories().find(memory => memory.id === id)?.content).toContain("added a migration");
    expect(events()).toHaveLength(4);
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ skipped: 2, sessionsImported: 0 });
  });

  it("retries incomplete JSONL without duplicating previously captured events", async () => {
    const diagnostic = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const path = join(root, "encoded-project", "session-1.jsonl");
    const tail = record("session-1", "assistant-2", "Completed after the partial write");
    writeFileSync(path, transcript() + tail.slice(0, 30));
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ memoriesCreated: 1, errors: 1 });
    expect(diagnostic).toHaveBeenCalled();
    appendFileSync(path, tail.slice(30));
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ memoriesCreated: 0, errors: 0 });
    expect(events()).toHaveLength(4);
    expect(memories()).toHaveLength(1);
    expect(memories()[0].content).toContain("completed after the partial write");
  });

  it("batches large sessions, redacts secrets, and preserves project isolation", async () => {
    const content = Array.from({ length: 505 }, (_, i) => record("large", `message-${i}`, `Step ${i}`)).join("");
    writeFileSync(join(root, "encoded-project", "large.jsonl"), content);
    const otherCwd = join(dir, "other-repo");
    mkdirSync(otherCwd);
    writeFileSync(join(root, "encoded-project", "other.jsonl"), JSON.stringify({
      type: "user", sessionId: "large", uuid: "other-user", cwd: otherCwd,
      message: { content: "password=super-secret-value" },
    }) + "\n");
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ sessionsImported: 2, memoriesCreated: 2, errors: 0 });
    expect(events("large")).toHaveLength(505);
    const otherProject = deriveProjectId(otherCwd);
    expect(listMemoriesByProject(context.db, otherProject)).toHaveLength(1);
    expect(listSessionEventsBySession(context.db, otherProject, "large")[0].payload_json).not.toContain("super-secret-value");
    expect(memories()).toHaveLength(1);
  });

  it("updates an existing hook summary and keeps subagent sessions separate", async () => {
    await context.service.call("summarizeSessionToMemory", {
      projectId, sessionId: "session-1", memoryId: "hook-summary", sourceAdapter: "claude-code",
      summary: "Existing hook summary", importance: 7,
    });
    writeFileSync(join(root, "encoded-project", "session-1.jsonl"), transcript());
    const subagents = join(root, "encoded-project", "session-1", "subagents");
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, "agent-one.jsonl"), transcript());
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ memoriesCreated: 1, errors: 0 });
    expect(events("agent-one")).toHaveLength(3);
    expect(memories()).toHaveLength(2);
    expect(memories().find(memory => memory.session_id === "session-1")?.id).toBe("hook-summary");
  });

  it("handles absent history and skips metadata-only transcripts", async () => {
    expect(await sweepTranscripts(context, { transcriptsDir: join(dir, "missing") })).toMatchObject({ filesFound: 0, errors: 0 });
    writeFileSync(join(root, "encoded-project", "metadata.jsonl"), '{"type":"file-history-snapshot"}\n');
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ filesFound: 1, skipped: 1, sessionsImported: 0 });
  });

  it("retries a failed summary after ingestion without duplicating events", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    writeFileSync(join(root, "encoded-project", "session-1.jsonl"), transcript());
    const call = context.service.call.bind(context.service);
    const failure = vi.spyOn(context.service, "call").mockImplementation(async (method, request) => {
      if (method === "handleSessionEnd") throw new Error("summary unavailable");
      return call(method, request);
    });
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ errors: 1, memoriesCreated: 0 });
    expect(events()).toHaveLength(3);
    failure.mockRestore();
    expect(await sweepTranscripts(context, { transcriptsDir: root })).toMatchObject({ errors: 0, memoriesCreated: 1 });
    expect(events()).toHaveLength(3);
    expect(memories()).toHaveLength(1);
  });

  it("dispatches scan and watch --once offline through the real CLI", async () => {
    writeFileSync(join(root, "encoded-project", "session-1.jsonl"), transcript());
    const env = { ...process.env, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_PROJECT_ID: "", ANTHROPIC_API_KEY: "" };
    const scan = await execFileAsync(process.execPath, [cliPath, "scan", "--transcripts-dir", root], { env });
    expect(scan.stdout).toContain("memories created: 1");
    const watch = await execFileAsync(process.execPath, [cliPath, "watch", "--once", "--transcripts-dir", root], { env });
    expect(watch.stdout).toContain("sessions imported: 0; memories created: 0; skipped: 1");
    expect(watch.stderr).toBe("");
    expect(memories()).toHaveLength(1);
  });

  it("stops the polling daemon cleanly on SIGTERM", async () => {
    if (process.platform === "win32") return;
    writeFileSync(join(root, "encoded-project", "session-1.jsonl"), transcript());
    const child = spawn(process.execPath, [cliPath, "watch", "--interval", "60", "--transcripts-dir", root], {
      env: { ...process.env, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_PROJECT_ID: "", ANTHROPIC_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const exit = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("watch produced no output")), 15000);
        child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
        child.once("error", reject);
        child.once("exit", () => reject(new Error("watch exited before the first sweep")));
      });
      child.kill("SIGTERM");
      expect(await exit).toEqual({ code: 0, signal: null });
      expect(memories()).toHaveLength(1);
    } finally { child.kill("SIGKILL"); }
  });
});
