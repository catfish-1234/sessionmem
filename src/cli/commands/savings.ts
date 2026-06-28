import { createCliContext, type CliContext } from "../context.js";
import { countTokens } from "../../core/injection/tokenBudget.js";
import { listMemoryContentsByProject } from "../../core/storage/memoryRepo.js";
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
  const memoryTokens = listMemoryContentsByProject(db, projectId).reduce(
    (sum, content) => sum + countTokens(content),
    0,
  );

  const rawEventTokens = listEventPayloads(db, projectId).reduce(
    (sum, p) => sum + countTokens(p),
    0,
  );

  const sessions = countDistinctSessions(db, projectId);

  // Read the injection cap from policy config if it exists; fall back to 450.
  const policyConfig = readPolicyConfig(
    options?.configPath ?? configFilePath(),
  );
  const injectionCap = policyConfig.injectionCap ?? DEFAULT_INJECTION_CAP;

  // --- calculations ---
  const tokensSaved = rawEventTokens - memoryTokens;
  // Clamp for display. When memories exist but no session events were ingested
  // (rawEventTokens === 0), the raw subtraction goes negative, which is
  // misleading. Never present a negative "tokens saved" to the user.
  const displayedTokensSaved = Math.max(0, tokensSaved);
  const savingsPct =
    rawEventTokens > 0 ? (tokensSaved / rawEventTokens) * 100 : 0;

  const estimatedReexplainTokens = memoryTokens * 3;
  const injectionSavings =
    estimatedReexplainTokens - sessions * injectionCap;
  const overallSaved = tokensSaved + Math.max(0, injectionSavings);
  const displayedOverallSaved = Math.max(0, overallSaved);
  const overallPct =
    rawEventTokens + estimatedReexplainTokens > 0
      ? (overallSaved / (rawEventTokens + estimatedReexplainTokens)) * 100
      : 0;
  const displayedOverallPct = displayedOverallSaved > 0 ? overallPct : 0;

  // per-session injection overhead (fixed cap, not a measured average)
  const avgInjectionCost = sessions > 0 ? injectionCap : 0;

  // --- JSON output ---
  if (options?.json) {
    const payload = {
      memoryTokens,
      rawEventTokens,
      tokensSaved: displayedTokensSaved,
      savingsPct: Math.round(savingsPct * 10) / 10,
      sessions,
      injectionCap,
      estimatedReexplainTokens,
      injectionSavings,
      overallSaved: displayedOverallSaved,
      overallPct: Math.round(displayedOverallPct * 10) / 10,
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

  // When no session events have been ingested, the storage-compression numbers
  // are meaningless (and "tokens saved" would be negative). Show a helpful note
  // instead of misleading figures.
  const storageLines =
    rawEventTokens === 0
      ? [
          "Storage compression:",
          "  No session data ingested yet.",
          "  Tip: call ingestSessionEvents during sessions to track token usage.",
        ]
      : [
          "Storage compression:",
          `  Raw session tokens:  ${fmt(rawEventTokens).padStart(10)}`,
          `  Memory tokens:       ${fmt(memoryTokens).padStart(10)}`,
          `  Tokens saved:        ${fmt(displayedTokensSaved).padStart(10)} (${(Math.round(savingsPct * 10) / 10).toFixed(1)}%)`,
        ];

  const lines = [
    "sessionmem token savings",
    "",
    ...storageLines,
    "",
    "Session injection:",
    `  Total sessions:      ${fmt(sessions).padStart(10)}`,
    `  Avg injection cost:  ${fmt(avgInjectionCost).padStart(10)} tokens/session`,
    `  Est. re-explain cost:${fmt(estimatedReexplainTokens).padStart(10)} tokens (without sessionmem)`,
    `  Injection savings:   ${fmt(Math.max(0, injectionSavings)).padStart(10)} tokens across ${fmt(sessions)} sessions`,
    "",
    "Overall:",
    `  Total tokens saved:  ${fmt(displayedOverallSaved).padStart(10)}`,
    `  Efficiency:          ${(Math.round(displayedOverallPct * 10) / 10).toFixed(1)}%`,
    "",
  ];

  process.stdout.write(lines.join("\n"));
}
