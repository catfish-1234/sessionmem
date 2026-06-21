const DAY_IN_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function getRecencyBandScore(
  updatedAt: Date | string,
  now: Date = new Date(),
): number {
  const updatedDate = toDate(updatedAt);
  const ageDays = Math.max(0, (now.getTime() - updatedDate.getTime()) / DAY_IN_MS);
  const HALF_LIFE_DAYS = 14;
  const lambda = Math.LN2 / HALF_LIFE_DAYS;
  return Math.max(0.05, Math.exp(-lambda * ageDays));
}
