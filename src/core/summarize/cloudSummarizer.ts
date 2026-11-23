import Anthropic from "@anthropic-ai/sdk";
import { capTokens } from "../injection/tokenBudget.js";
import type { SessionEventRecord } from "../storage/types.js";
import type { LocalSummarizeInput, SummarizerResult } from "./localSummarizer.js";
import { summarizeLocalSessionEvents } from "./localSummarizer.js";
import { DEFAULT_SUMMARIZER_MODEL } from "../config/policyConfig.js";

/** Output budget for thinking, on top of the summary itself. */
const THINKING_ROOM = 2048;
/** Ceiling for one non-streaming response. */
const MAX_RESPONSE_TOKENS = 16000;
/**
 * How long one cloud request may take. Summaries run inside the SessionEnd hook, which the host
 * kills after a minute by default, so a stalled request must give up in time for the local
 * fallback. The SDK's own retries are off: the session lifecycle retries, against a deadline.
 */
export const CLOUD_REQUEST_TIMEOUT_MS = 25_000;
/** Request settings that only the default summarizer model is known to accept. */
const DEFAULT_MODEL_TUNING = {
  output_config: { effort: "low" as const },
  betas: ["server-side-fallback-2026-07-01" as const],
  fallbacks: "default" as const,
};

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
  const client = new Anthropic({ apiKey: input.anthropicApiKey, timeout: CLOUD_REQUEST_TIMEOUT_MS, maxRetries: 0 });

  const response = await client.beta.messages.create({
    model,
    // Current models think before they answer, and thinking counts against
    // max_tokens, so the budget leaves room for it on top of the summary.
    // Capped so a large summaryTokenCap cannot pass an out-of-range value.
    max_tokens: Math.min(Math.floor((input.summaryTokenCap ?? 4000) * 1.5) + THINKING_ROOM, MAX_RESPONSE_TOKENS),
    // Tuned for the default model: compressing a prepared transcript is a
    // simple transform, so it runs at low effort, and a policy decline is
    // retried server-side on Anthropic's default fallback model. A
    // caller-chosen model keeps its own defaults, because older models
    // reject effort and some models (Claude Haiku 5.5) reject fallbacks.
    ...(model === DEFAULT_SUMMARIZER_MODEL ? DEFAULT_MODEL_TUNING : {}),
    system: CLOUD_SYSTEM_PROMPT,
    messages: [{ role: "user", content: localResult.summary }],
  });

  // A decline carries no usable summary; the lifecycle's local fallback runs.
  if (response.stop_reason === "refusal") {
    throw new Error("Cloud summarizer declined the request");
  }

  // Read text blocks by type: a response can begin with thinking blocks.
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Throw on an empty response rather than storing an empty memory; the
  // session-lifecycle retry/fallback-to-local path handles the failure.
  if (!text || text.trim().length === 0) {
    throw new Error("Cloud summarizer returned empty response");
  }


  return {
    summary: capTokens(text, input.summaryTokenCap),
    warningCodes: localResult.warningCodes,
  };
}
