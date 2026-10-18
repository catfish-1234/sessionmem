import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { CliContext } from "./context.js";
import type { SweepSummary } from "./transcriptSweep.js";

export interface WatchCheckpoint {
  dbPath: string;
  completedAt: string;
  intervalSeconds: number;
  checkpointCount: number;
  summary: SweepSummary;
}
export const watchCheckpointPath = (dbPath: string): string => join(dirname(resolve(dbPath)), `${basename(dbPath)}.watch-checkpoint.json`);

export function saveWatchCheckpoint(context: CliContext, summary: SweepSummary, intervalSeconds: number): void {
  if (context.dbPath === ":memory:") return;
  const path = watchCheckpointPath(context.dbPath);
  const checkpoint: WatchCheckpoint = {
    dbPath: resolve(context.dbPath), completedAt: new Date().toISOString(), intervalSeconds,
    checkpointCount: (context.db.prepare("SELECT count(*) AS n FROM transcript_checkpoints").get() as { n: number }).n,
    summary,
  };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(checkpoint), { mode: 0o600 });
  renameSync(temp, path);
}

export function inspectWatchCheckpoint(dbPath: string, now = Date.now()): string {
  const checkpoint = JSON.parse(readFileSync(watchCheckpointPath(dbPath), "utf8")) as WatchCheckpoint;
  const age = now - Date.parse(checkpoint.completedAt);
  if (checkpoint.dbPath !== resolve(dbPath)) throw new Error("Watcher checkpoint belongs to a different database");
  if (!Number.isFinite(checkpoint.intervalSeconds) || checkpoint.intervalSeconds <= 0 || checkpoint.intervalSeconds > 86400) throw new Error("Invalid watcher checkpoint interval");
  if (!Number.isFinite(age) || age < -60000 || age > Math.max(120000, checkpoint.intervalSeconds * 3000)) throw new Error(`Watcher checkpoint is stale or invalid (${checkpoint.completedAt})`);
  if (!checkpoint.summary || Object.values(checkpoint.summary).length !== 5 || Object.values(checkpoint.summary).some(value => !Number.isInteger(value) || value < 0)) throw new Error("Invalid watcher sweep counters");
  if (checkpoint.summary.errors !== 0) throw new Error(`Last watcher sweep had ${checkpoint.summary.errors} capture error(s)`);
  if (!Number.isInteger(checkpoint.checkpointCount) || checkpoint.checkpointCount < 0) throw new Error("Invalid transcript checkpoint count");
  if (checkpoint.summary.filesFound > 0 && checkpoint.checkpointCount === 0) throw new Error("Transcripts found but none checkpointed yet");
  return `Sweep completed ${Math.max(0, Math.round(age / 1000))}s ago; ${checkpoint.checkpointCount} transcript checkpoint(s); ${checkpoint.summary.filesFound} source file(s)`;
}
