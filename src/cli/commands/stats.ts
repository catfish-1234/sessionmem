import { statSync } from "fs";
import { createCliContext, type CliContext } from "../context.js";
import { countTokens } from "../../core/injection/tokenBudget.js";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";
import {
  configFilePath,
  readPolicyConfig,
} from "../../core/config/policyConfig.js";

interface StatsOptions {
  /** Override the policy config path. Test seam (defaults to configFilePath()). */
  configPath?: string;
}

export async function statsCommand(
  ctx?: CliContext,
  options?: StatsOptions,
): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("stats", {
    projectId: context.projectId,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(context.dbPath).size;
  } catch {
    // dbPath may be ":memory:" or the file may have been removed; report 0
  }
  const totalTokens = listMemoriesByProject(context.db, context.projectId).reduce(
    (sum, m) => sum + countTokens(m.content),
    0,
  );

  // Effective policy: retention window + redaction state for visibility.
  const { retentionDays, redactionEnabled } = readPolicyConfig(
    options?.configPath ?? configFilePath(),
  );

  // retentionDays<=0 disables pruning; report that rather than a
  // misleading eligible count against a non-positive window.
  let retentionLine: string;
  if (retentionDays <= 0) {
    retentionLine = "Retention: pruning disabled (retentionDays <= 0)";
  } else {
    const prune = await context.service.call("pruneMemories", {
      projectId: context.projectId,
      retentionDays,
      dryRun: true,
    });
    const eligible = prune.ok ? prune.eligible : 0;
    retentionLine = `Retention: ${retentionDays} days (${eligible} memories eligible for pruning)`;
  }

  const redactionLine = `Redaction: ${redactionEnabled ? "enabled" : "disabled"}`;

  process.stdout.write(
    `memories: ${result.totalMemories}\n` +
      `db_size_bytes: ${sizeBytes}\n` +
      `total_content_tokens: ${totalTokens}\n` +
      `${retentionLine}\n` +
      `${redactionLine}\n`,
  );
}
