import { normalizeEmbeddingText } from "../embed/textNormalize.js";
import type { SessionEventRecord } from "../storage/types.js";
import { applyRedaction, type RedactionRule } from "./redaction.js";
import { buildStructuredSummary, type FactMode } from "./summaryShape.js";

export interface LocalSummarizeInput {
  events: SessionEventRecord[];
  summaryTokenCap: number;
  redactionEnabled: boolean;
  factMode: FactMode;
  redactionRules?: RedactionRule[];
}

export interface SummarizerResult {
  summary: string;
  warningCodes: string[];
}

function countTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function capTokens(text: string, cap: number): string {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= cap) {
    return text;
  }
  return `${tokens.slice(0, cap).join(" ")} ...`;
}

export async function summarizeLocalSessionEvents(
  input: LocalSummarizeInput,
): Promise<SummarizerResult> {
  const structured = buildStructuredSummary(input.events, {
    factMode: input.factMode,
  });
  const redactionResult = applyRedaction(structured, {
    redactionEnabled: input.redactionEnabled,
    rules: input.redactionRules,
  });

  const normalized = normalizeEmbeddingText(redactionResult.text);
  const capped = capTokens(normalized, input.summaryTokenCap);
  if (countTokens(capped) > input.summaryTokenCap) {
    throw new Error("summary exceeds summaryTokenCap");
  }

  return {
    summary: capped,
    warningCodes: redactionResult.warningCodes,
  };
}
