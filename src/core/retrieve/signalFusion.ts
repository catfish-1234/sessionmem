import { lexicalQueryTerms } from "../storage/memorySearchRepo.js";

export const RETRIEVAL_RANKINGS = ["legacy", "adaptive-bm25", "hub-additive", "adaptive-hub-additive"] as const;
export type RetrievalRanking = typeof RETRIEVAL_RANKINGS[number];

/** Fixed hypotheses from the requested public-source audit, independently implemented. */
export function adaptiveLexicalScore(raw: number, query: string): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 0;
  const count = lexicalQueryTerms(query).length;
  const bands: Array<[number, number, number]> = [[3, 5, 0.7], [6, 7, 0.6], [9, 9, 0.5], [15, 10, 0.5], [Infinity, 12, 0.5]];
  const [, midpoint, steepness] = bands.find(([ceiling]) => count <= ceiling)!;
  return 1 / (1 + Math.exp(steepness * (midpoint - raw)));
}

export const SEMANTIC_GATE = 0.2;
export function additiveRelevance(signals: { lexical?: number; dense?: number; entity?: number }): number | null {
  if (signals.dense !== undefined && signals.dense < SEMANTIC_GATE) return null;
  const capacity = Number(signals.lexical !== undefined) + Number(signals.dense !== undefined) + 0.5 * Number(signals.entity !== undefined);
  if (!capacity) return 0;
  const sum = (signals.lexical ?? 0) + (signals.dense ?? 0) + (signals.entity ?? 0);
  return Math.max(0, Math.min(1, sum / capacity));
}
