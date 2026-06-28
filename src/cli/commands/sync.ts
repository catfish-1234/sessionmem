import { join } from "path";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import {
  configFilePath,
  readPolicyConfig,
} from "../../core/config/policyConfig.js";
import { importMemoryRecordSchema } from "../../core/api/contracts.js";
import type { z } from "zod";
import { createCliContext, type CliContext } from "../context.js";

interface SyncOptions {
  /** Test seam: point at a temp config file instead of ~/.sessionmem/config.json. */
  configPath?: string;
}

/**
 * Skip any teammate file larger than this. A network/shared drive can host an
 * arbitrarily large (or maliciously huge) file; reading it whole with
 * `readFileSync` would balloon memory. Skip-and-warn instead, matching the
 * resilient pull semantics for unreadable/non-array files.
 */
const MAX_TEAMMATE_FILE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * `pullMemoriesRequestSchema` rejects any batch over MAX_IMPORT_SIZE (1000)
 * records, so accumulating every teammate's memories into one array would let a
 * large team blow the cap and discard the whole pull. Send in chunks of this
 * size instead.
 */
const MAX_BATCH = 1000;

/**
 * `sessionmem sync` — push a full snapshot of local project memories to the
 * shared path and pull every teammate's snapshot back into the local DB.
 *
 * No-ops with a clear message when team mode is disabled. Push writes
 * `{sharedPath}/{projectId}/{username}.json` atomically (temp-file + rename).
 * Pull enumerates every other `*.json` in that dir, skip-and-warns
 * on unreadable/non-array files, validates each record, and merges
 * via `pullMemories` (MAX-importance LWW + re-redaction + cross-project skip).
 */
export async function syncCommand(
  ctx?: CliContext,
  options?: SyncOptions,
): Promise<void> {
  const context = ctx ?? createCliContext();

  const config = readPolicyConfig(options?.configPath ?? configFilePath());
  const { enabled, sharedPath } = config.team;

  // Clean no-op (exit 0) when team mode is off or unconfigured.
  if (!enabled || !sharedPath) {
    console.log(
      "Team mode is not enabled. Run `sessionmem team enable <path>`.",
    );
    return;
  }

  // ---- PUSH (model export.ts) ----
  const exportRes = await context.service.call("exportMemories", {
    projectId: context.projectId,
  });
  if (!exportRes.ok) {
    console.error(exportRes.error.message);
    process.exit(1);
    return;
  }

  // Build every shared path with path.join ONLY (Windows/UNC safe).
  // The project dir + filename derive from the LOCAL projectId/username, never
  // from a string inside a teammate file.
  // projectId/username are sanitized to [A-Za-z0-9._-] in context.ts
  // (localUsername/deriveProjectId), so no path traversal here.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const dir = join(sharedPath, context.projectId);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const finalPath = join(dir, `${context.username}.json`);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const tmpPath = join(dir, `${context.username}.json.tmp`);

  try {
    mkdirSync(dir, { recursive: true });
    // Atomic write — temp file in the SAME dir then rename,
    // so a teammate never reads a half-written snapshot off a network drive.
    writeFileSync(tmpPath, JSON.stringify(exportRes.memories, null, 2), "utf8");
    renameSync(tmpPath, finalPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Missing/unwritable shared path -> stderr + non-zero exit.
    console.error(`Failed to write to shared path: ${message}`);
    process.exit(1);
    return;
  }
  const pushed = exportRes.memories.length;

  // ---- PULL (model import.ts) ----
  let teammateFiles: string[];
  try {
    teammateFiles = readdirSync(dir).filter(
      (f) => f.endsWith(".json") && f !== `${context.username}.json`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read shared path: ${message}`);
    process.exit(1);
    return;
  }

  const memories: Array<z.infer<typeof importMemoryRecordSchema>> = [];

  for (const file of teammateFiles) {
    // file comes from readdirSync(dir) filtered to *.json entries, so it is a
    // plain filename with no path separators, not user input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const filePath = join(dir, file);

    // Guard against an oversized teammate file before reading it whole.
    try {
      const stat = statSync(filePath);
      if (stat.size > MAX_TEAMMATE_FILE_BYTES) {
        console.warn(
          `sessionmem: skipping ${file} (${stat.size} bytes exceeds 10MB limit)`,
        );
        continue;
      }
    } catch {
      console.error(`Skipping unreadable teammate file: ${file}`);
      continue;
    }

    let parsed: unknown;
    try {
      // A truncated/corrupt teammate file is skipped-and-warned, never
      // aborting the rest of the pull.
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      console.error(`Skipping unreadable teammate file: ${file}`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      console.error(`Skipping teammate file (not an array): ${file}`);
      continue;
    }

    for (const raw of parsed as Array<Record<string, unknown>>) {
      // Carry author/originProjectId through; per-record skip-and-warn so one
      // bad record never discards the rest.
      const check = importMemoryRecordSchema.safeParse(raw);
      if (!check.success) {
        console.error(
          `Skipping invalid record in ${file}: ${check.error.message}`,
        );
        continue;
      }
      memories.push(check.data);
    }
  }

  let pulledNew = 0;
  let pulledUpdated = 0;

  // Split into batches of MAX_BATCH (1000) so a large team never trips
  // pullMemoriesRequestSchema's max(MAX_IMPORT_SIZE) and discards the whole pull.
  for (let i = 0; i < memories.length; i += MAX_BATCH) {
    const batch = memories.slice(i, i + MAX_BATCH);
    const pullRes = await context.service.call("pullMemories", {
      projectId: context.projectId,
      memories: batch,
    });
    if (!pullRes.ok) {
      console.error(pullRes.error.message);
      process.exit(1);
      return;
    }
    pulledNew += pullRes.pulledNew;
    pulledUpdated += pullRes.pulledUpdated;
  }

  // The exact summary string.
  console.log(
    `Pushed ${pushed} memories, pulled ${pulledNew} new + updated ${pulledUpdated} from teammates.`,
  );
}
