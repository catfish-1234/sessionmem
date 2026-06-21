import { normalizeEmbeddingText } from "../embed/textNormalize.js";
import { capTokens, countTokens } from "../injection/tokenBudget.js";
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
