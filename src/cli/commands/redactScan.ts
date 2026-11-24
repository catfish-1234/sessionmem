import { createCliContext, type CliContext } from "../context.js";

interface RedactScanOptions {
  /** --apply: redact matching rows in place (default is a non-destructive scan). */
  apply?: boolean;
}

/**
 * `sessionmem redact-scan [--apply]`.
 *
 * Scan-by-default one-time scrub over pre-existing memories: with no
 * flags it reports `Found N memories with potential secrets` plus truncated,
 * already-redacted previews and writes nothing. `--apply` redacts matching rows
 * in place and prints a summary count.
 *
 * The underlying `redactExisting` service builds previews from the REDACTED text
 * (never the raw secret) and length-bounds them, so printing them as-is cannot
 * leak a full secret. Scan always calls with apply:false so a missing
 * --apply can never mutate data.
 */
export async function redactScanCommand(
  options: RedactScanOptions,
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  const apply = !!options.apply;

  const result = await context.service.call("redactExisting", {
    projectId: context.projectId,
    apply,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const eventsMatched = result.eventsMatched ?? 0;
  if (apply) {
    if (result.skipped > 0) {
      console.log(
        `Redacted ${result.updated} memories; ${result.skipped} skipped (not found).`,
      );
    } else {
      console.log(`Redacted ${result.updated} memories.`);
    }
    if (eventsMatched > 0) console.log(`Redacted ${result.eventsUpdated ?? 0} stored session events.`);
    return;
  }

  // Scan (non-destructive): report match count and print the safe previews.
  console.log(`Found ${result.matched} memories with potential secrets`);
  for (const preview of result.previews) {
    console.log(`  ${preview}`);
  }
  // Event payloads are raw tool output, so they are counted rather than previewed.
  if (eventsMatched > 0) {
    console.log(`Found ${eventsMatched} stored session events with potential secrets (run with --apply to redact them)`);
  }
}
