import { join } from "path";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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
 * `sessionmem sync` — push a full snapshot of local project memories to the
 * shared path and pull every teammate's snapshot back into the local DB
 * (TEAM-01).
 *
 * No-ops with a clear message when team mode is disabled (D-13). Push writes
 * `{sharedPath}/{projectId}/{username}.json` atomically (temp-file + rename,
 * Pitfall 4). Pull enumerates every other `*.json` in that dir, skip-and-warns
 * on unreadable/non-array files (T-07-03), validates each record, and merges
 * via `pullMemories` (MAX-importance LWW + re-redaction + cross-project skip).
 * Prints the D-16 summary.
 */
export async function syncCommand(
  ctx?: CliContext,
  options?: SyncOptions,
): Promise<void> {
  const context = ctx ?? createCliContext();

  const config = readPolicyConfig(options?.configPath ?? configFilePath());
  const { enabled, sharedPath } = config.team;

  // D-13: clean no-op (exit 0) when team mode is off or unconfigured.
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

  // Pitfall 2: build every shared path with path.join ONLY (Windows/UNC safe).
  // The project dir + filename derive from the LOCAL projectId/username, never
  // from a string inside a teammate file (T-07-07).
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
    // Pitfall 4 / T-07-12: atomic write — temp file in the SAME dir then rename,
    // so a teammate never reads a half-written snapshot off a network drive.
    writeFileSync(tmpPath, JSON.stringify(exportRes.memories, null, 2), "utf8");
    renameSync(tmpPath, finalPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // D-03: missing/unwritable shared path -> stderr + non-zero exit.
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
    let parsed: unknown;
    try {
      // T-07-03: a truncated/corrupt teammate file is skipped-and-warned, never
      // aborting the rest of the pull.
      // file comes from readdirSync(dir) filtered to *.json entries, so it is
      // a plain filename with no path separators, not user input.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
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
      // bad record never discards the rest (IN-02 precedent).
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

  if (memories.length > 0) {
    const pullRes = await context.service.call("pullMemories", {
      projectId: context.projectId,
      memories,
    });
    if (!pullRes.ok) {
      console.error(pullRes.error.message);
      process.exit(1);
      return;
    }
    pulledNew = pullRes.pulledNew;
    pulledUpdated = pullRes.pulledUpdated;
  }

  // D-16: the exact summary string.
  console.log(
    `Pushed ${pushed} memories, pulled ${pulledNew} new + updated ${pulledUpdated} from teammates.`,
  );
}
