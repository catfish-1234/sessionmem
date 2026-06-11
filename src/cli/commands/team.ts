import { accessSync, constants, existsSync } from "fs";
import {
  configFilePath,
  readPolicyConfig,
  writePolicyConfig,
} from "../../core/config/policyConfig.js";
import { createCliContext, type CliContext } from "../context.js";

interface TeamCommandOptions {
  /** Test seam: point at a temp config file instead of ~/.sessionmem/config.json. */
  configPath?: string;
}

interface TeamDisableOptions extends TeamCommandOptions {
  /** Full local-only revert: delete teammate-authored rows for this project. */
  removeTeamMemories?: boolean;
}

function resolvePath(options?: TeamCommandOptions): string {
  return options?.configPath ?? configFilePath();
}

/**
 * `sessionmem team enable <path>` — turn on team mode and record the shared path.
 * Missing/empty path -> error to stderr + exit 1 (Phase 5 D-03).
 */
export function teamEnableCommand(
  sharedPath: string,
  options?: TeamCommandOptions,
): void {
  if (!sharedPath || sharedPath.trim() === "") {
    console.error("team enable requires a shared path argument.");
    process.exit(1);
    return;
  }

  writePolicyConfig(resolvePath(options), {
    team: { enabled: true, sharedPath },
  });
  console.log(`Team mode enabled. Shared path: ${sharedPath}`);
}

/**
 * `sessionmem team status` — print enabled state + the shared path, and report
 * whether that path exists and is writable. Reads local fs only (T-07-10).
 * Does NOT print a last-sync time — there is no synced_at column (D-08).
 */
export function teamStatusCommand(options?: TeamCommandOptions): void {
  const config = readPolicyConfig(resolvePath(options));
  const { enabled, sharedPath } = config.team;

  console.log(`Team mode: ${enabled ? "enabled" : "disabled"}`);

  if (!sharedPath) {
    console.log("Shared path: not set");
    return;
  }

  console.log(`Shared path: ${sharedPath}`);

  if (!existsSync(sharedPath)) {
    console.log("Shared path status: does not exist");
    return;
  }

  let writable = false;
  try {
    accessSync(sharedPath, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  console.log(
    `Shared path status: exists, ${writable ? "writable" : "not writable"}`,
  );
}

/**
 * `sessionmem team disable [--remove-team-memories]` — stop team sync.
 *
 * Default (TEAM-03): flip enabled to false and KEEP already-pulled teammate
 * rows (no data loss). With `--remove-team-memories` (D-15): additionally
 * delete rows authored by someone other than the local username for the current
 * project, reverting to a local-only store. The DELETE binds projectId/username
 * as parameters — never string-concatenated (T-07-08 / T-06-11 precedent).
 */
export function teamDisableCommand(
  options?: TeamDisableOptions,
  ctx?: CliContext,
): void {
  writePolicyConfig(resolvePath(options), { team: { enabled: false } });

  if (!options?.removeTeamMemories) {
    console.log("Team mode disabled. Teammate memories preserved.");
    return;
  }

  const context = ctx ?? createCliContext();
  const result = context.db
    .prepare("DELETE FROM memories WHERE project_id = ? AND author != ?")
    .run(context.projectId, context.username);

  console.log(
    `Team mode disabled. Removed ${result.changes} teammate-authored ${
      result.changes === 1 ? "memory" : "memories"
    }.`,
  );
}
