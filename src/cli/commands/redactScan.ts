import { createCliContext, type CliContext } from "../context.js";

interface RedactScanOptions {
  /** --apply: redact matching rows in place (default is a non-destructive scan, D-14). */
  apply?: boolean;
}

/**
 * `sessionmem redact-scan [--apply]`.
 *
 * Scan-by-default one-time scrub over pre-existing memories (D-07/D-14): with no
 * flags it reports `Found N memories with potential secrets` plus truncated,
 * already-redacted previews and writes nothing. `--apply` redacts matching rows
 * in place and prints a summary count.
 *
 * The underlying `redactExisting` service builds previews from the REDACTED text
 * (never the raw secret) and length-bounds them, so printing them as-is cannot
 * leak a full secret (T-06-20). Scan always calls with apply:false so a missing
 * --apply can never mutate data (T-06-22).
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

  if (apply) {
    console.log(`Redacted ${result.updated} memories.`);
    return;
  }

  // Scan (non-destructive): report match count and print the safe previews.
  console.log(`Found ${result.matched} memories with potential secrets`);
  for (const preview of result.previews) {
    console.log(`  ${preview}`);
  }
}
