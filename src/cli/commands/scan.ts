import { createCliContext, type CliContext } from "../context.js";
import { printSweepSummary, sweepTranscripts, type ScanOptions, type SweepSummary } from "../transcriptSweep.js";

export async function scanCommand(options: ScanOptions = {}, ctx?: CliContext): Promise<SweepSummary> {
  const context = ctx ?? createCliContext();
  try {
    const summary = await sweepTranscripts(context, options);
    printSweepSummary("scan", summary);
    if (summary.errors) process.exitCode = 1;
    return summary;
  } finally {
    if (!ctx) context.db.close();
  }
}
