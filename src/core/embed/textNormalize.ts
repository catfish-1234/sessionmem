const INTERNAL_WHITESPACE = /\s+/g;

/**
 * Normalize text before deterministic embedding generation.
 * Order is fixed by plan contract: trim -> collapse whitespace -> NFKC -> lowercase.
 */
export function normalizeEmbeddingText(text: string): string {
  return text
    .trim()
    .replace(INTERNAL_WHITESPACE, " ")
    .normalize("NFKC")
    .toLowerCase();
}
