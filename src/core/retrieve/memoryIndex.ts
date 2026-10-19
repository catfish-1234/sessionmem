/** Extractive preview only. No generated summary or extra inference. */
export function memoryIndexItem(memory: { id: string; content: string; kind: string; created_at: string }, score: number | null = null) {
  const text = memory.content.replace(/\s+/g, " ").trim();
  return { id: memory.id, summary: text.length > 160 ? `${text.slice(0, 157)}...` : text,
    kind: memory.kind, date: memory.created_at, score: score === null ? null : Math.round(score * 10000) / 10000 };
}
