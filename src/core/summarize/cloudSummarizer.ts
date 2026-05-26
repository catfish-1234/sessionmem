import type { SessionEventRecord } from "../storage/types.js";
import type { LocalSummarizeInput, SummarizerResult } from "./localSummarizer.js";
import { summarizeLocalSessionEvents } from "./localSummarizer.js";

const DEFAULT_CLOUD_MODEL = "claude-sonnet-4-20250514";

export interface CloudSummarizeInput
  extends Omit<LocalSummarizeInput, "events"> {
  events: SessionEventRecord[];
  anthropicApiKey: string;
  model?: string;
}

export async function summarizeWithCloud(
  input: CloudSummarizeInput,
): Promise<SummarizerResult> {
  if (!input.anthropicApiKey.trim()) {
    throw new Error("Missing anthropicApiKey");
  }

  const result = await summarizeLocalSessionEvents({
    events: input.events,
    summaryTokenCap: input.summaryTokenCap,
    redactionEnabled: input.redactionEnabled,
    factMode: input.factMode,
    redactionRules: input.redactionRules,
  });

  const modelTag = input.model ?? DEFAULT_CLOUD_MODEL;
  return {
    summary: `[model:${modelTag}] ${result.summary}`,
    warningCodes: result.warningCodes,
  };
}
