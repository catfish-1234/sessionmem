const DEFAULT_DECAY_THRESHOLD_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface DecayMemoryInput {
  id: string;
  importance: number;
  updated_at: string;
}

/**
 * Apply time-based importance decay. Memories decay by 1 point per week
 * after the first week of inactivity, capping decay at -3 so even old
 * memories remain discoverable (minimum effective importance = stored - 3).
 * This produces a smoother ranking fade-out vs. the previous single -1 step.
 */
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
    const weeksOverThreshold = Number.isFinite(ageDays) && ageDays > thresholdDays
      ? Math.floor((ageDays - thresholdDays) / 7)
      : 0;
    const decayAmount = Math.min(weeksOverThreshold, 3);

    return {
      ...memory,
      decayedImportance: Math.max(1, memory.importance - decayAmount),
    };
  });
}
