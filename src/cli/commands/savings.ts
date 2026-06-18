import { createCliContext, type CliContext } from "../context.js";
import { countTokens } from "../../core/injection/tokenBudget.js";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";
import {
  countDistinctSessions,
  listEventPayloads,
} from "../../core/storage/tokenSavingsRepo.js";
import {
  readPolicyConfig,
  configFilePath,
} from "../../core/config/policyConfig.js";

/** Default injection token cap, mirroring formatStartupInjection.ts. */
const DEFAULT_INJECTION_CAP = 450;

interface SavingsOptions {
  json?: boolean;
  /** Override the policy config path. Test seam (defaults to configFilePath()). */
  configPath?: string;
}

export function savingsCommand(
  ctx?: CliContext,
  options?: SavingsOptions,
): void {
  const context = ctx ?? createCliContext();
  const { db, projectId } = context;

  // --- gather raw numbers ---
  const memoryTokens = listMemoriesByProject(db, projectId).reduce(
    (sum, m) => sum + countTokens(m.content),
    0,
  );

  const rawEventTokens = listEventPayloads(db, projectId).reduce(
    (sum, p) => sum + countTokens(p),
    0,
  );

  const sessions = countDistinctSessions(db, projectId);

  // Read the injection cap from policy config if it exists; fall back to 450.
  const _config = readPolicyConfig(
    options?.configPath ?? configFilePath(),
  );
  const injectionCap =
    ((_config as Record<string, unknown>).injectionCap as number | undefined) ??
    DEFAULT_INJECTION_CAP;

  // --- calculations ---
  const tokensSaved = rawEventTokens - memoryTokens;
  const savingsPct =
    rawEventTokens > 0 ? (tokensSaved / rawEventTokens) * 100 : 0;

  const estimatedReexplainTokens = memoryTokens * 3;
  const injectionSavings =
    estimatedReexplainTokens - sessions * injectionCap;
  const overallSaved = tokensSaved + Math.max(0, injectionSavings);
  const overallPct =
    rawEventTokens + estimatedReexplainTokens > 0
      ? (overallSaved / (rawEventTokens + estimatedReexplainTokens)) * 100
      : 0;

  const avgInjectionCost =
    sessions > 0
      ? Math.round((sessions * injectionCap) / sessions)
      : 0;

  // --- JSON output ---
  if (options?.json) {
    const payload = {
      memoryTokens,
      rawEventTokens,
      tokensSaved,
      savingsPct: Math.round(savingsPct * 10) / 10,
      sessions,
      injectionCap,
      estimatedReexplainTokens,
      injectionSavings,
      overallSaved,
      overallPct: Math.round(overallPct * 10) / 10,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  // --- empty state ---
  if (rawEventTokens === 0 && memoryTokens === 0) {
    process.stdout.write(
      "No session data yet. Token savings will appear after your first session.\n",
    );
    return;
  }

  // --- formatted report ---
  const fmt = (n: number) => n.toLocaleString("en-US");

  const lines = [
    "sessionmem token savings",
    "",
    "Storage compression:",
    `  Raw session tokens:  ${fmt(rawEventTokens).padStart(10)}`,
    `  Memory tokens:       ${fmt(memoryTokens).padStart(10)}`,
    `  Tokens saved:        ${fmt(tokensSaved).padStart(10)} (${(Math.round(savingsPct * 10) / 10).toFixed(1)}%)`,
    "",
    "Session injection:",
    `  Total sessions:      ${fmt(sessions).padStart(10)}`,
    `  Avg injection cost:  ${fmt(avgInjectionCost).padStart(10)} tokens/session`,
    `  Est. re-explain cost:${fmt(estimatedReexplainTokens).padStart(10)} tokens (without sessionmem)`,
    `  Injection savings:   ${fmt(Math.max(0, injectionSavings)).padStart(10)} tokens across ${fmt(sessions)} sessions`,
    "",
    "Overall:",
    `  Total tokens saved:  ${fmt(overallSaved).padStart(10)}`,
    `  Efficiency:          ${(Math.round(overallPct * 10) / 10).toFixed(1)}%`,
    "",
  ];

  process.stdout.write(lines.join("\n"));
}
