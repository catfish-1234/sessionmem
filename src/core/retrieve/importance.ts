import { MIN_IMPORTANCE, MAX_IMPORTANCE } from "../config/policyConfig.js";

export function normalizeImportance(score1to10: number): number {
  if (!Number.isFinite(score1to10) || score1to10 < MIN_IMPORTANCE || score1to10 > MAX_IMPORTANCE) {
    throw new Error(`importance must be between ${MIN_IMPORTANCE} and ${MAX_IMPORTANCE}`);
  }

  return (score1to10 - MIN_IMPORTANCE) / (MAX_IMPORTANCE - MIN_IMPORTANCE);
}
