export interface ExistingEmbeddingState {
  normalizedText: string;
  embeddingVersion: string;
}

export function shouldReembed(
  previous: ExistingEmbeddingState,
  nextNormalizedText: string,
  currentVersion: string,
): boolean {
  if (previous.normalizedText !== nextNormalizedText) {
    return true;
  }

  if (previous.embeddingVersion !== currentVersion) {
    return true;
  }

  return false;
}
