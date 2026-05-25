export function normalizeImportance(score1to10: number): number {
  if (!Number.isFinite(score1to10) || score1to10 < 1 || score1to10 > 10) {
    throw new Error("importance must be between 1 and 10");
  }

  return (score1to10 - 1) / 9;
}
