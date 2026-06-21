import Anthropic from "@anthropic-ai/sdk";
import type { SessionEventRecord } from "../storage/types.js";
import type { LocalSummarizeInput, SummarizerResult } from "./localSummarizer.js";
import { summarizeLocalSessionEvents } from "./localSummarizer.js";
import { DEFAULT_SUMMARIZER_MODEL } from "../config/policyConfig.js";

const CLOUD_SYSTEM_PROMPT =
  "You are a memory compressor for AI coding sessions. Given this session transcript summary, produce a compact, high-signal list of facts, decisions, and context that should be remembered. Be extremely concise.";

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

  // Step 1: Preprocess via local summarizer (extract, redact, structure)
  const localResult = await summarizeLocalSessionEvents({
    events: input.events,
    summaryTokenCap: input.summaryTokenCap,
    redactionEnabled: input.redactionEnabled,
    factMode: input.factMode,
    redactionRules: input.redactionRules,
  });

  // Step 2: Send preprocessed summary to Claude for compression
  const model = input.model ?? DEFAULT_SUMMARIZER_MODEL;
  const client = new Anthropic({ apiKey: input.anthropicApiKey });

  const response = await client.messages.create({
    model,
    max_tokens: input.summaryTokenCap * 2,
    system: CLOUD_SYSTEM_PROMPT,
    messages: [{ role: "user", content: localResult.summary }],
  });

  // Extract text from response content blocks
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    summary: text,
    warningCodes: localResult.warningCodes,
  };
}
