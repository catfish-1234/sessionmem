import { createHash } from "node:crypto";

import { EMBEDDING_VERSION } from "./embeddingVersion.js";
import { normalizeEmbeddingText } from "./textNormalize.js";

export interface DeterministicEmbedding {
  vector: number[];
  normalizedText: string;
  dimension: number;
  embeddingVersion: string;
}

function nextHash(seed: string, blockIndex: number): Buffer {
  return createHash("sha256").update(`${seed}:${blockIndex}`).digest();
}

export function deterministicEmbed(
  input: string,
  dimension: number,
): DeterministicEmbedding {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("dimension must be a positive integer");
  }

  const normalizedText = normalizeEmbeddingText(input);
  const vector: number[] = [];
  let blockIndex = 0;

  while (vector.length < dimension) {
    const bytes = nextHash(normalizedText, blockIndex);
    blockIndex += 1;

    for (const byte of bytes) {
      const value = (byte / 255) * 2 - 1;
      vector.push(value);

      if (vector.length === dimension) {
        break;
      }
    }
  }

  return {
    vector,
    normalizedText,
    dimension,
    embeddingVersion: EMBEDDING_VERSION,
  };
}
