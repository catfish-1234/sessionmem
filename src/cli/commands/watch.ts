import { openWatchLog } from "../watchLog.js";
import { saveWatchCheckpoint } from "../watchCheckpoint.js";
import { setTimeout } from "node:timers/promises";
import { createCliContext, type CliContext } from "../context.js";
import { printSweepSummary, sweepTranscripts, type ScanOptions } from "../transcriptSweep.js";

export interface WatchOptions extends ScanOptions {
  once?: boolean;
  dbPath?: string;
  logFile?: string;
  interval?: string | number;
}

export async function watchCommand(options: WatchOptions = {}, ctx?: CliContext): Promise<void> {
  const interval = Number(options.interval ?? 5);
  if (!Number.isFinite(interval) || interval <= 0 || interval > 86400) {
    throw new Error("--interval must be a number greater than 0 and at most 86400 seconds");
  }
  const closeLog = openWatchLog(options.logFile);
  let context: CliContext | undefined;
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let firstSweep = true;
  try {
    console.log(`sessionmem watch starting (pid ${process.pid}, interval ${interval}s)`);
    context = ctx ?? createCliContext({ dbPath: options.dbPath });
    do {
      try {
        const summary = await sweepTranscripts(context, options);
        saveWatchCheckpoint(context, summary, interval);
        if (firstSweep || options.once || summary.sessionsImported || summary.errors) {
          printSweepSummary("watch", summary);
        }
        firstSweep = false;
        if (options.once && summary.errors) process.exitCode = 1;
      } catch (error) {
        if (options.once) throw error;
        console.error(`[sessionmem] watch: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (options.once || controller.signal.aborted) break;
      try { await setTimeout(interval * 1000, undefined, { signal: controller.signal }); }
      catch (error) { if (!controller.signal.aborted) throw error; }
    } while (!controller.signal.aborted);
  } catch (error) {
    console.error(`[sessionmem] watch failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (!ctx) context?.db.close();
    console.log("sessionmem watch stopped");
    closeLog();
  }
}
