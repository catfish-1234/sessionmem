import { createCliContext, type CliContext } from "../context.js";
import {
  configFilePath,
  readPolicyConfig,
  resolvePolicySettings,
} from "../../core/config/policyConfig.js";
import { MAX_RETENTION_DAYS } from "./config.js";

interface RetentionPruneOptions {
  /** --force: actually delete (default is dry-run, D-12). */
  force?: boolean;
  /** --days <n>: CLI override of the effective retention window (highest precedence). */
  days?: string;
}

/**
 * `sessionmem retention prune [--force] [--days <n>]`.
 *
 * Dry-run by default (D-12): prints the eligible count and exits 0 without
 * deleting. `--force` hard-deletes eligible memories and prints a summary count.
 *
 * Effective retentionDays follows precedence CLI flag > config.json > default
 * (D-11) via {@link resolvePolicySettings}. The dry-run path always calls
 * pruneMemories with dryRun:true so a missing --force can never delete.
 */
export async function retentionPruneCommand(
  options: RetentionPruneOptions,
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  // --days override must be a clean integer, matching `config set
  // retention.days`'s validation (WR-02): Number.parseInt("30abc", 10) === 30
  // would otherwise silently accept trailing garbage. Also enforce the same
  // upper bound as `config set` (WR-01) so an out-of-range --days can't
  // produce an Invalid Date / RangeError when computing the prune cutoff.
  let override: { retentionDays: number } | undefined;
  if (options.days !== undefined) {
    const trimmed = options.days.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      console.error(`Invalid --days value "${options.days}": expected an integer.`);
      process.exit(1);
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed > MAX_RETENTION_DAYS) {
      console.error(
        `Invalid --days value "${options.days}": must be <= ${MAX_RETENTION_DAYS}.`,
      );
      process.exit(1);
    }
    override = { retentionDays: parsed };
  }

  const { retentionDays } = resolvePolicySettings({
    override,
    config: readPolicyConfig(configFilePath()),
  });

  const dryRun = !options.force;

  const result = await context.service.call("pruneMemories", {
    projectId: context.projectId,
    retentionDays,
    dryRun,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (dryRun) {
    console.log(
      `Would delete ${result.eligible} memories older than ${retentionDays} days. Pass --force to confirm.`,
    );
    return;
  }

  console.log(`Deleted ${result.deleted} memories.`);
}
