import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { buildToolEvent } from "../core/capture/toolEvent.js";
import { handleSessionEndConfigSchema, MAX_INGEST_EVENTS } from "../core/api/contracts.js";
import { expandTilde, type CliContext } from "./context.js";
import { deriveProjectId } from "./projectId.js";

export interface ScanOptions {
  transcriptsDir?: string;
}

export interface SweepSummary {
  filesFound: number;
  sessionsImported: number;
  memoriesCreated: number;
  skipped: number;
  errors: number;
}

type JsonObject = Record<string, unknown>;
type CapturedEvent = { id: string; eventType: string; payloadJson: string };

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : undefined;
}

function stableId(...parts: string[]): string {
  return `transcript-${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

/** Translate the transcript envelope; tool normalization stays shared with ingest-hook. */
async function readTranscript(path: string): Promise<{
  cwd?: string;
  sessionId: string;
  events: CapturedEvent[];
  malformed: boolean;
}> {
  const result = {
    cwd: undefined as string | undefined,
    sessionId: basename(path, ".jsonl"),
    events: [] as CapturedEvent[],
    malformed: false,
  };
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineIndex = 0;
  try {
    for await (const line of lines) {
      const index = lineIndex++;
      if (!line.trim()) continue;
      let record: JsonObject | undefined;
      try { record = object(JSON.parse(line.replace(/^\uFEFF/, ""))); }
      catch { result.malformed = true; continue; }
      if (!record) continue;
      if (!result.cwd && typeof record.cwd === "string" && record.cwd.trim()) {
        result.cwd = record.cwd;
      }
      // Subagent files share their parent's sessionId; retain their own filename.
      if (!basename(path).startsWith("agent-") && typeof record.sessionId === "string") {
        result.sessionId = record.sessionId;
      }
      if (record.type !== "user" && record.type !== "assistant") continue;
      const message = object(record.message);
      const content = message?.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }]
        : Array.isArray(content) ? content : [];
      for (const [blockIndex, rawBlock] of blocks.entries()) {
        const block = object(rawBlock);
        if (!block) continue;
        const key = typeof record.uuid === "string" ? record.uuid : `line-${index}`;
        if (block.type === "tool_use" && typeof block.name === "string") {
          const event = buildToolEvent(block.name, object(block.input), result.cwd);
          if (event) result.events.push({
            id: typeof block.id === "string" ? `tool-${block.id}` : `${key}-${blockIndex}`,
            ...event,
          });
        } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          result.events.push({
            id: `${key}-${blockIndex}`,
            eventType: `message:${record.type}`,
            payloadJson: JSON.stringify({ text: block.text.slice(0, 4000) }),
          });
        }
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return result;
}

async function* transcriptFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* transcriptFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path, { bigint: true });
  return `${process.env.SESSIONMEM_PROJECT_ID ?? ""}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

export async function sweepTranscripts(context: CliContext, options: ScanOptions = {}): Promise<SweepSummary> {
  const directory = resolve(expandTilde(options.transcriptsDir ?? join(homedir(), ".claude", "projects")));
  const summary: SweepSummary = { filesFound: 0, sessionsImported: 0, memoriesCreated: 0, skipped: 0, errors: 0 };
  const importedSessions = new Set<string>();
  const checkpoint = context.db.prepare("SELECT fingerprint FROM transcript_checkpoints WHERE path = ?");
  const saveCheckpoint = context.db.prepare("INSERT OR REPLACE INTO transcript_checkpoints (path, fingerprint) VALUES (?, ?)");

  for await (const path of transcriptFiles(directory)) {
    summary.filesFound++;
    try {
      const before = await fingerprint(path);
      if ((checkpoint.get(path) as { fingerprint: string } | undefined)?.fingerprint === before) {
        summary.skipped++;
        continue;
      }
      const transcript = await readTranscript(path);
      if (!transcript.cwd || transcript.events.length === 0) {
        summary.skipped++;
        if (!transcript.malformed) saveCheckpoint.run(path, before);
        else throw new Error("malformed or incomplete JSONL; will retry");
        continue;
      }
      const projectId = deriveProjectId(transcript.cwd);
      const sessionId = transcript.sessionId;
      for (let offset = 0; offset < transcript.events.length; offset += MAX_INGEST_EVENTS) {
        const result = await context.service.call("ingestSessionEvents", {
          projectId,
          sessionId,
          events: transcript.events.slice(offset, offset + MAX_INGEST_EVENTS).map(event => ({
            ...event, id: stableId(projectId, sessionId, event.id),
          })),
        });
        if (!result.ok) throw new Error(result.error.message);
      }
      const existing = context.db.prepare("SELECT id FROM memories WHERE project_id = ? AND session_id = ? AND kind = 'summary' LIMIT 1")
        .get(projectId, sessionId) as { id: string } | undefined;
      // The pipeline upserts by project/session; keep existing hook summary IDs.
      const memoryId = existing?.id ?? stableId(projectId, sessionId, "summary");
      const result = await context.service.call("handleSessionEnd", {
        projectId,
        sessionId,
        memoryId,
        sourceAdapter: "claude-code",
        config: handleSessionEndConfigSchema.parse({ minimumEventThreshold: 1, allowCloudSummarization: false }),
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.status !== "stored") throw new Error(`summary ${result.status}; will retry`);
      importedSessions.add(JSON.stringify([projectId, sessionId]));
      summary.sessionsImported = importedSessions.size;
      if (!existing) summary.memoriesCreated++;
      if (transcript.malformed) throw new Error("malformed or incomplete JSONL; will retry");
      // Never mark concurrent appends as processed. The next sweep replays safely.
      if (await fingerprint(path) === before) saveCheckpoint.run(path, before);
    } catch (error) {
      summary.errors++;
      process.stderr.write(`[sessionmem] ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return summary;
}

export function printSweepSummary(command: string, summary: SweepSummary): void {
  console.log(`sessionmem ${command}: files found: ${summary.filesFound}; sessions imported: ${summary.sessionsImported}; memories created: ${summary.memoriesCreated}; skipped: ${summary.skipped}; errors: ${summary.errors}`);
}
