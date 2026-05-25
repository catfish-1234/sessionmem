import type { Database } from "better-sqlite3";

import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import {
  scoreMemoryCandidate,
  type ScoreBreakdown,
} from "./score.js";
import {
  searchMemoryCandidates,
  type MemorySearchCandidate,
} from "../storage/memorySearchRepo.js";

const DEFAULT_EMBEDDING_DIMENSION = 32;

export interface RetrieveMemoriesInput {
  db: Database;
  projectId: string;
  queryText?: string;
  query?: string;
  topK?: number;
  limit?: number;
  now?: Date;
}

export interface RetrievedMemoryCandidate {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  kind: string;
  content: string;
  normalized_content: string;
  importance: number;
  created_at: string;
  updated_at: string;
  embedding_dim: number | null;
  embedding_version: string | null;
  semantic: number;
  score: ScoreBreakdown;
}

function resolveEmbeddingDimension(candidates: MemorySearchCandidate[]): number {
  for (const candidate of candidates) {
    if (Number.isInteger(candidate.embedding_dim) && (candidate.embedding_dim ?? 0) > 0) {
      return candidate.embedding_dim as number;
    }

    if (candidate.embedding && candidate.embedding.length > 0) {
      return candidate.embedding.length;
    }
  }

  return DEFAULT_EMBEDDING_DIMENSION;
}

function cosineSimilarity(query: number[], candidate: number[] | null): number {
  if (!candidate || candidate.length !== query.length) {
    return 0;
  }

  let dot = 0;
  let queryMagnitude = 0;
  let candidateMagnitude = 0;

  for (let i = 0; i < query.length; i += 1) {
    const queryValue = query[i];
    const candidateValue = candidate[i];
    dot += queryValue * candidateValue;
    queryMagnitude += queryValue * queryValue;
    candidateMagnitude += candidateValue * candidateValue;
  }

  if (queryMagnitude === 0 || candidateMagnitude === 0) {
    return 0;
  }

  const similarity = dot / (Math.sqrt(queryMagnitude) * Math.sqrt(candidateMagnitude));
  return Math.max(-1, Math.min(1, similarity));
}

export function retrieveMemories(
  input: RetrieveMemoriesInput,
): RetrievedMemoryCandidate[] {
  const queryText = input.queryText ?? input.query;
  if (!queryText) {
    throw new Error("queryText is required");
  }

  const topK = input.topK ?? input.limit ?? 20;
  const now = input.now ?? new Date();
  const candidates = searchMemoryCandidates(input.db, input.projectId);
  const dimension = resolveEmbeddingDimension(candidates);
  const queryVector = deterministicEmbed(queryText, dimension).vector;

  const ranked = candidates
    .map((candidate) => {
      const semantic = cosineSimilarity(queryVector, candidate.embedding);
      const score = scoreMemoryCandidate(
        {
          semantic,
          updated_at: candidate.updated_at,
          importance: candidate.importance,
        },
        now,
      );

      return {
        id: candidate.id,
        project_id: candidate.project_id,
        session_id: candidate.session_id,
        source_adapter: candidate.source_adapter,
        kind: candidate.kind,
        content: candidate.content,
        normalized_content: candidate.normalized_content,
        importance: candidate.importance,
        created_at: candidate.created_at,
        updated_at: candidate.updated_at,
        embedding_dim: candidate.embedding_dim,
        embedding_version: candidate.embedding_version,
        semantic,
        score,
      };
    })
    .sort((left, right) => {
      if (right.score.total !== left.score.total) {
        return right.score.total - left.score.total;
      }

      if (right.updated_at !== left.updated_at) {
        return right.updated_at.localeCompare(left.updated_at);
      }

      return left.id.localeCompare(right.id);
    });

  return ranked.slice(0, topK);
}
