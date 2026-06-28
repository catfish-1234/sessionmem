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
    // Cap the per-response token budget so a large summaryTokenCap cannot pass
    // an out-of-range max_tokens to the API (which would error).
    max_tokens: Math.min(Math.floor((input.summaryTokenCap ?? 4000) * 1.5), 8192),
    system: CLOUD_SYSTEM_PROMPT,
    messages: [{ role: "user", content: localResult.summary }],
  });

  // Extract text from response content blocks
  let text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Throw on an empty response rather than storing an empty memory; the
  // session-lifecycle retry/fallback-to-local path handles the failure.
  if (!text || text.trim().length === 0) {
    throw new Error("Cloud summarizer returned empty response");
  }

  // Cap cloud output to summaryTokenCap (rough token→char ratio) for parity
  // with the local summarizer, so a verbose cloud response cannot blow past the
  // configured budget.
  if (input.summaryTokenCap && text.length > input.summaryTokenCap * 4) {
    text = text.slice(0, input.summaryTokenCap * 4);
  }

  return {
    summary: text,
    warningCodes: localResult.warningCodes,
  };
}
