import type { Database } from "better-sqlite3";
import { entityOverlap } from "../storage/knowledgeRepo.js";

import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { decayOldBoosts } from "./decay.js";
import {
  scoreMemoryCandidate,
  type ScoreBreakdown,
} from "./score.js";
import {
  searchMemoryCandidatesFTS,
  type MemorySearchCandidate,
} from "../storage/memorySearchRepo.js";

const DEFAULT_EMBEDDING_DIMENSION = 32;
// Small, fixed contribution inside the existing relevance component. Keep the
// public score shape/outer recency and importance weights unchanged.
const ENTITY_RELEVANCE_WEIGHT = 0.10;

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
  author: string;
  origin_project_id: string | null;
  access_count: number;
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

  // FTS5 retrieves up to 50 BM25 matches; sparse matches retain the existing
  // recency/importance fallback. The public request schema validates queryText.
  const candidates = searchMemoryCandidatesFTS(
    input.db,
    input.projectId,
    queryText,
    now,
  );
  const decayedCandidates = decayOldBoosts(candidates, now);
  const dimension = resolveEmbeddingDimension(candidates);
  const queryVector = deterministicEmbed(queryText, dimension).vector;
  const overlap = entityOverlap(input.db, input.projectId, queryText, now);

  // FTS5 returns negative BM25 ranks; storage converts them to positive scores.
  // Normalize within this query so BM25 fits the existing relevance weight.
  const maxLexicalScore = candidates.reduce(
    (max, candidate) => Math.max(max, candidate.lexical_score),
    0,
  );

  const ranked = decayedCandidates
    .map((candidate) => {
      // When embedding is null (version mismatch or missing), use a neutral
      // score of 0.5 so the memory is neither penalized nor boosted. A non-null
      // embedding whose length differs from the query vector (a stored
      // embedding from a different dimension) is treated the same way: passing
      // it to cosineSimilarity would return 0 and actively penalize the row.
      const semantic =
        candidate.embedding === null ||
        candidate.embedding.length !== queryVector.length
          ? 0.5
          : cosineSimilarity(queryVector, candidate.embedding);
      // Hash cosine is useful for identical text, but adds noise to lexical
      // matches. Keep it as a diagnostic and as the no-match fallback only.
      const baseRelevance = maxLexicalScore > 0
        ? candidate.lexical_score / maxLexicalScore
        : semantic;
      const relevance = overlap.size > 0
        ? (1 - ENTITY_RELEVANCE_WEIGHT) * baseRelevance + ENTITY_RELEVANCE_WEIGHT * (overlap.get(candidate.id) ?? 0)
        : baseRelevance;
      const score = scoreMemoryCandidate(
        {
          semantic: relevance,
          updated_at: candidate.updated_at,
          importance: candidate.importance,
          access_count: candidate.access_count,
          decayedImportance: candidate.decayedImportance,
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
        author: candidate.author,
        origin_project_id: candidate.origin_project_id,
        access_count: candidate.access_count,
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
