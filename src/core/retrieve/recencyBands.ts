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

  if (ageDays <= 1) {
    return 1.0;
  }

  if (ageDays <= 7) {
    return 0.75;
  }

  if (ageDays <= 30) {
    return 0.5;
  }

  return 0.25;
}
