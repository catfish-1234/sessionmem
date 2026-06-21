import { normalizeImportance } from "./importance.js";
import { getRecencyBandScore } from "./recencyBands.js";

export const SCORING_WEIGHTS = {
  semantic: 0.60,
  recency: 0.25,
  importance: 0.15,
} as const;

export const ACCESS_BOOST_THRESHOLD = 3;
export const ACCESS_BOOST_AMOUNT = 2;

export function computeEffectiveImportance(
  storedImportance: number,
  accessCount: number,
): number {
  if (accessCount >= ACCESS_BOOST_THRESHOLD) {
    return Math.min(storedImportance + ACCESS_BOOST_AMOUNT, 10);
  }
  return storedImportance;
}

export interface ScoreMemoryCandidateInput {
  semantic: number;
  updated_at: string;
  importance: number;
  access_count?: number;
  decayedImportance?: number;
}

export interface ScoreBreakdown {
  raw: {
    semantic: number;
    recency: number;
    importance: number;
  };
  weighted: {
    semantic: number;
    recency: number;
    importance: number;
  };
  total: number;
}

export function scoreMemoryCandidate(
  candidate: ScoreMemoryCandidateInput,
  now: Date = new Date(),
): ScoreBreakdown {
  const recency = getRecencyBandScore(candidate.updated_at, now);
  const baseImportance = candidate.decayedImportance ?? candidate.importance;
  const effectiveImportance = computeEffectiveImportance(
    baseImportance,
    candidate.access_count ?? 0,
  );
  const importance = normalizeImportance(effectiveImportance);

  const weighted = {
    semantic: candidate.semantic * SCORING_WEIGHTS.semantic,
    recency: recency * SCORING_WEIGHTS.recency,
    importance: importance * SCORING_WEIGHTS.importance,
  };

  return {
    raw: {
      semantic: candidate.semantic,
      recency,
      importance,
    },
    weighted,
    total: weighted.semantic + weighted.recency + weighted.importance,
  };
}
