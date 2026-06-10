import { createCliContext, type CliContext } from "../context.js";
import {
  configFilePath,
  readPolicyConfig,
  resolvePolicySettings,
} from "../../core/config/policyConfig.js";

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

  // --days override is parsed as a positive integer; anything invalid is treated
  // as "no override" so we fall through to config.json / default.
  let override: { retentionDays: number } | undefined;
  if (options.days !== undefined) {
    const parsed = Number.parseInt(options.days, 10);
    if (!Number.isNaN(parsed)) {
      override = { retentionDays: parsed };
    }
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
