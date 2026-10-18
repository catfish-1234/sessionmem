import { stat } from "node:fs/promises";
import { handleSessionEndConfigSchema, MAX_INGEST_EVENTS } from "../core/api/contracts.js";
import { type CliContext } from "./context.js";
import { deriveProjectId } from "./projectId.js";
import { isCursorSource, readTranscript, transcriptFiles, transcriptSources, type TranscriptOptions } from "./transcripts/index.js";
import { cursorDatabasePath, readCursorTranscripts } from "./transcripts/cursor.js";
import { stableId, type CapturedEvent, type TranscriptHost } from "./transcripts/types.js";

export type ScanOptions = TranscriptOptions;

export interface SweepSummary {
  filesFound: number;
  sessionsImported: number;
  memoriesCreated: number;
  skipped: number;
  errors: number;
}

async function fingerprint(path: string, host?: TranscriptHost): Promise<string> {
  const info = await stat(path, { bigint: true });
  // Version the checkpoint so files scanned by the old Claude-only reader are
  // retried, and a changed host claim cannot reuse a previous parser's result.
  return `hosts-v1:${host ?? "auto"}:${process.env.SESSIONMEM_PROJECT_ID ?? ""}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

interface PendingFile { path: string; before: string; host?: TranscriptHost; malformed: boolean; snapshot?: boolean }
interface SessionGroup {
  host: TranscriptHost;
  projectId: string;
  sessionId: string;
  events: Map<string, CapturedEvent>;
  files: PendingFile[];
}

export async function sweepTranscripts(context: CliContext, options: ScanOptions = {}): Promise<SweepSummary> {
  const sources = transcriptSources(options);
  const summary: SweepSummary = { filesFound: 0, sessionsImported: 0, memoriesCreated: 0, skipped: 0, errors: 0 };
  const groups = new Map<string, SessionGroup>();
  const checkpoint = context.db.prepare("SELECT fingerprint FROM transcript_checkpoints WHERE path = ?");
  const saveCheckpoint = context.db.prepare("INSERT OR REPLACE INTO transcript_checkpoints (path, fingerprint) VALUES (?, ?)");
  const report = (path: string, error: unknown) => {
    summary.errors++;
    process.stderr.write(`[sessionmem] ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
  };

  for (const source of sources) {
    try {
      if (source.host === "cursor" || (!source.host && await isCursorSource(source.directory))) {
        const path = await cursorDatabasePath(source.directory);
        if (!path) continue;
        summary.filesFound++;
        for (const transcript of await readCursorTranscripts(path)) {
          const projectId = deriveProjectId(transcript.cwd!);
          const checkpointPath = `cursor:${JSON.stringify([path, transcript.sessionId])}`;
          // A database/WAL fingerprint is insufficient: unrelated settings and
          // other composers change it. Hash only this composer's bounded events.
          const before = stableId("cursor-v1", projectId, JSON.stringify(transcript.events));
          if ((checkpoint.get(checkpointPath) as { fingerprint: string } | undefined)?.fingerprint === before) {
            summary.skipped++;
            continue;
          }
          if (!transcript.events.length) {
            summary.skipped++;
            saveCheckpoint.run(checkpointPath, before);
            continue;
          }
          groups.set(JSON.stringify(["cursor", projectId, transcript.sessionId]), {
            host: "cursor", projectId, sessionId: transcript.sessionId,
            events: new Map(transcript.events.map(event => [event.id, event])),
            files: [{ path: checkpointPath, before, host: "cursor", malformed: false, snapshot: true }],
          });
        }
        continue;
      }
      for await (const path of transcriptFiles(source.directory)) {
        summary.filesFound++;
        try {
          const before = await fingerprint(path, source.host);
          if ((checkpoint.get(path) as { fingerprint: string } | undefined)?.fingerprint === before) {
            summary.skipped++;
            continue;
          }
          const transcript = await readTranscript(path, source.host);
          if (transcript.malformed) report(path, "malformed or incomplete JSONL; will retry");
          if (!transcript.cwd || transcript.events.length === 0) {
            summary.skipped++;
            if (!transcript.malformed && await fingerprint(path, source.host) === before) saveCheckpoint.run(path, before);
            continue;
          }
          const projectId = deriveProjectId(transcript.cwd);
          const key = JSON.stringify([transcript.host, projectId, transcript.sessionId]);
          let group = groups.get(key);
          if (!group) {
            group = { host: transcript.host, projectId, sessionId: transcript.sessionId, events: new Map(), files: [] };
            groups.set(key, group);
          }
          for (const event of transcript.events) {
            if (!group.events.has(event.id)) group.events.set(event.id, event);
          }
          group.files.push({ path, before, host: source.host, malformed: transcript.malformed });
        } catch (error) { report(path, error); }
      }
    } catch (error) { report(source.directory, error); }
  }

  for (const group of groups.values()) {
    const { projectId, sessionId, host } = group;
    try {
      const events = [...group.events.values()];
      for (let offset = 0; offset < events.length; offset += MAX_INGEST_EVENTS) {
        const result = await context.service.call("ingestSessionEvents", {
          projectId, sessionId,
          // Cursor edits the same bubble while streaming a response.
          replaceExisting: host === "cursor",
          events: events.slice(offset, offset + MAX_INGEST_EVENTS).map(event => ({
            // Preserve existing Claude IDs for compatibility with earlier sweeps.
            ...event, id: host === "claude-code" ? stableId(projectId, sessionId, event.id)
              : stableId(host, projectId, sessionId, event.id),
          })),
        });
        if (!result.ok) throw new Error(result.error.message);
      }
      const existing = context.db.prepare("SELECT id FROM memories WHERE project_id = ? AND session_id = ? AND kind = 'summary' LIMIT 1")
        .get(projectId, sessionId) as { id: string } | undefined;
      const memoryId = existing?.id ?? stableId(projectId, sessionId, "summary");
      const result = await context.service.call("handleSessionEnd", {
        projectId, sessionId, memoryId, sourceAdapter: host,
        config: handleSessionEndConfigSchema.parse({ minimumEventThreshold: 1, allowCloudSummarization: false }),
      });
      if (!result.ok) throw new Error(result.error.message);
      if (result.status !== "stored") throw new Error(`summary ${result.status}; will retry`);
      summary.sessionsImported++;
      if (!existing) summary.memoriesCreated++;
      for (const file of group.files) {
        // Never mark concurrent appends or incomplete files as processed.
        // Cursor checkpoints describe the copied snapshot, so a newer live
        // commit will be discovered by the next fresh read without a stat gate.
        if (!file.malformed && (file.snapshot || await fingerprint(file.path, file.host) === file.before)) {
          saveCheckpoint.run(file.path, file.before);
        }
      }
    } catch (error) {
      for (const file of group.files) report(file.path, error);
    }
  }
  return summary;
}

export function printSweepSummary(command: string, summary: SweepSummary): void {
  console.log(`sessionmem ${command}: files found: ${summary.filesFound}; sessions imported: ${summary.sessionsImported}; memories created: ${summary.memoriesCreated}; skipped: ${summary.skipped}; errors: ${summary.errors}`);
}
