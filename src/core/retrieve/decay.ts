const DEFAULT_DECAY_THRESHOLD_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface DecayMemoryInput {
  id: string;
  importance: number;
  updated_at: string;
}

export function decayOldBoosts<T extends DecayMemoryInput>(
  memories: T[],
  now: Date = new Date(),
  thresholdDays = DEFAULT_DECAY_THRESHOLD_DAYS,
): Array<T & { decayedImportance: number }> {
  return memories.map((memory) => {
    const updatedAt = new Date(memory.updated_at);
    const ageDays = Math.max(
      0,
      (now.getTime() - updatedAt.getTime()) / DAY_IN_MS,
    );
    const shouldDecay = Number.isFinite(ageDays) && ageDays > thresholdDays;

    return {
      ...memory,
      decayedImportance: shouldDecay
        ? Math.max(1, memory.importance - 1)
        : memory.importance,
    };
  });
}
