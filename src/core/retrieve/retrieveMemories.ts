import type { Database } from "better-sqlite3";
import { matchingScopeIds, type ScopeSelection } from "../scopes.js";
import { entityOverlap } from "../storage/knowledgeRepo.js";
import { linkedEntityScores } from "../storage/entityLinkRepo.js";
import { memoryTemporalMetadata } from "../storage/temporalRepo.js";
import { adaptiveLexicalScore, additiveRelevance, SEMANTIC_GATE, type RetrievalRanking } from "./signalFusion.js";
import { detectTemporalIntent, temporalRelevance } from "./temporalIntent.js";
import type { SemanticCandidate } from "../storage/semanticSearchRepo.js";

import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { decayOldBoosts } from "./decay.js";
import {
  scoreMemoryCandidate,
  type ScoreBreakdown,
} from "./score.js";
import {
  searchMemoryCandidatesFTS,
  searchMemoryCandidatesByIds,
  type MemorySearchCandidate,
} from "../storage/memorySearchRepo.js";

const DEFAULT_EMBEDDING_DIMENSION = 32;
// Small, fixed contribution inside the existing relevance component. Keep the
// public score shape/outer recency and importance weights unchanged.
const ENTITY_RELEVANCE_WEIGHT = 0.10;
// At most 0.06 of the final score, before optional temporal attenuation.
const MAX_ENTITY_BOOST = 0.10;

export interface RetrieveMemoriesInput extends ScopeSelection {
  db: Database;
  projectId: string;
  queryText?: string;
  query?: string;
  topK?: number;
  limit?: number;
  now?: Date;
  includeHistory?: boolean;
  semanticCandidates?: SemanticCandidate[];
  temporalRetrieval?: boolean;
  entityLinkBoost?: boolean;
  entityBoost?: boolean;
  ranking?: RetrievalRanking;
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
  const ranking = input.ranking ?? "legacy";
  const additive = ranking === "hub-additive" || ranking === "adaptive-hub-additive";
  const adaptive = ranking === "adaptive-bm25" || ranking === "adaptive-hub-additive";
  const intent = input.temporalRetrieval ? detectTemporalIntent(queryText, now) : { kind: "none" as const };
  const includeHistory = input.includeHistory ?? intent.kind === "past";
  if (input.scopeMode !== undefined && input.scope === undefined) throw new Error("scopeMode requires scope");
  const scopeFilter = input.scope !== undefined && input.scopeMode !== "boost" ? { scope: input.scope } : undefined;

  // FTS5 retrieves up to 50 BM25 matches; sparse matches retain the existing
  // recency/importance fallback. The public request schema validates queryText.
  const lexicalCandidates = searchMemoryCandidatesFTS(
    input.db,
    input.projectId,
    queryText,
    now,
    includeHistory,
    scopeFilter,
  );
  const candidates = [...lexicalCandidates];
  const ids = new Set(candidates.map(c => c.id));
  const entityMatches = input.entityLinkBoost || additive || input.entityBoost
    ? linkedEntityScores(input.db, input.projectId, queryText, now, includeHistory, additive, scopeFilter)
    : new Map<string, number>();
  // Keep the older coverage/fusion experiment independent of the positive boost.
  const linked = input.entityLinkBoost || additive ? entityMatches : new Map<string, number>();
  for (const candidate of searchMemoryCandidatesByIds(input.db, input.projectId, [...entityMatches.keys()].slice(0, 50), now, includeHistory, scopeFilter)) {
    if (!ids.has(candidate.id)) { candidates.push(candidate); ids.add(candidate.id); }
  }
  const semanticCandidates = scopeFilter
    ? searchMemoryCandidatesByIds(input.db, input.projectId, input.semanticCandidates?.map(row => row.candidate.id) ?? [], now, includeHistory, scopeFilter)
    : input.semanticCandidates?.map(row => row.candidate) ?? [];
  for (const candidate of semanticCandidates) {
    if (!ids.has(candidate.id)) { candidates.push(candidate); ids.add(candidate.id); }
  }
  const dense = new Map(input.semanticCandidates?.map(c => [c.candidate.id, c.similarity]));
  const decayedCandidates = decayOldBoosts(candidates, now);
  const dimension = resolveEmbeddingDimension(candidates);
  const queryVector = deterministicEmbed(queryText, dimension).vector;
  const overlap = entityOverlap(input.db, input.projectId, queryText, now, scopeFilter);
  const scopeMatches = input.scope !== undefined && input.scopeMode === "boost"
    ? matchingScopeIds(input.db, input.projectId, candidates.map(row => row.id), input.scope) : new Set<string>();
  const temporal = intent.kind !== "none" ? memoryTemporalMetadata(input.db, input.projectId, candidates.map(c => c.id)) : new Map();

  // FTS5 returns negative BM25 ranks; storage converts them to positive scores.
  // Normalize within this query so BM25 fits the existing relevance weight.
  const maxLexicalScore = candidates.reduce(
    (max, candidate) => Math.max(max, candidate.lexical_score),
    0,
  );

  const ranked = decayedCandidates
    .filter(candidate => !additive || !input.semanticCandidates?.length || (dense.get(candidate.id) ?? 0) >= SEMANTIC_GATE)
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
      const lexicalRelevance = maxLexicalScore > 0
        ? adaptive ? adaptiveLexicalScore(candidate.lexical_score, queryText) : candidate.lexical_score / maxLexicalScore
        : semantic;
      // The local dense variant was weaker alone. Preserve lexical dominance
      // while admitting candidates absent from FTS, using a fixed 2:1 blend.
      const baseRelevance = input.semanticCandidates?.length
        ? maxLexicalScore > 0
          ? (2 * lexicalRelevance + Math.max(0, dense.get(candidate.id) ?? 0)) / 3
          : Math.max(0, dense.get(candidate.id) ?? 0)
        : lexicalRelevance;
      const fused = additive ? additiveRelevance({
        lexical: maxLexicalScore > 0 ? lexicalRelevance : undefined,
        dense: input.semanticCandidates?.length ? Math.max(0, dense.get(candidate.id) ?? 0) : undefined,
        entity: linked.size > 0 ? linked.get(candidate.id) ?? 0 : undefined,
      }) : null;
      const entityRelevance = additive && fused !== null ? fused : linked.size > 0
        ? 0.8 * baseRelevance + 0.2 * (linked.get(candidate.id) ?? 0)
        : overlap.size > 0
        ? (1 - ENTITY_RELEVANCE_WEIGHT) * baseRelevance + ENTITY_RELEVANCE_WEIGHT * (overlap.get(candidate.id) ?? 0)
        : baseRelevance;
      // Add evidence without discounting other candidates. Multiple names and
      // aliases share one normalized score, so repetitions cannot stack boosts.
      const boostedRelevance = input.entityBoost
        ? Math.min(1, entityRelevance + MAX_ENTITY_BOOST * (entityMatches.get(candidate.id) ?? 0))
        : entityRelevance;
      const scopedRelevance = scopeMatches.has(candidate.id) ? Math.min(1, boostedRelevance + 0.10) : boostedRelevance;
      const metadata = temporal.get(candidate.id);
      const relevance = metadata
        ? 0.9 * scopedRelevance + 0.1 * temporalRelevance(intent, metadata.timestamp, metadata.supersededFraction, now)
        : scopedRelevance;
      const score = scoreMemoryCandidate(
        {
          semantic: relevance,
          // Historical lookup should not lose evidence merely because it is old.
          updated_at: intent.kind === "past" ? now.toISOString() : candidate.updated_at,
          importance: candidate.importance,
          access_count: candidate.access_count,
          decayedImportance: intent.kind === "past" ? candidate.importance : candidate.decayedImportance,
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
