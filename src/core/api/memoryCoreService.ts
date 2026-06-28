import { userInfo } from "node:os";
import type { Database } from "better-sqlite3";
import { type z, ZodError, type ZodType } from "zod";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { retrieveMemories } from "../retrieve/retrieveMemories.js";
import { computeEffectiveImportance } from "../retrieve/score.js";
import { formatStartupInjection } from "../injection/formatStartupInjection.js";
import { applyRedaction } from "../summarize/redaction.js";
import type { RetrievedMemoryCandidate } from "../retrieve/retrieveMemories.js";
import {
  countAllMemoriesByProject,
  countMemoriesBySession,
  countMemoriesOlderThan,
  deleteMemoriesOlderThan,
  deleteMemoryById,
  getMemoryOwnerProjectId,
  getMemoryRecordById,
  incrementAccessCounts,
  insertMemory,
  listMemoriesByProject,
  resetAccessCounts,
  updateMemoryContent,
  upsertImportedMemory,
  upsertPulledMemory,
  upsertSessionSummaryMemory,
} from "../storage/memoryRepo.js";
import {
  SESSION_WRITE_SOFT_LIMIT,
  configFilePath,
  DEEP_MODE_RETRIEVAL_CAP,
  readPolicyConfig,
  resolvePolicySettings,
} from "../config/policyConfig.js";
import { insertMemoryFeedbackEvent } from "../storage/memoryFeedbackRepo.js";
import { countAllSessionEvents, insertSessionEvent } from "../storage/sessionEventsRepo.js";
import type { MemoryRecord } from "../storage/types.js";
import {
  batchStoreMemoryItemSchema,
  batchStoreMemoryRequestSchema,
  exportMemoriesRequestSchema,
  forgetMemoryRequestSchema,
  getMemoryRequestSchema,
  handleSessionEndRequestSchema,
  importMemoriesRequestSchema,
  pullMemoriesRequestSchema,
  ingestSessionEventsRequestSchema,
  LIST_MEMORIES_DEFAULT_LIMIT,
  listMemoriesRequestSchema,
  pruneMemoriesRequestSchema,
  redactExistingRequestSchema,
  resetAccessCountsRequestSchema,
  retrieveMemoriesRequestSchema,
  statsRequestSchema,
  storeMemoryRequestSchema,
  summarizeSessionToMemoryRequestSchema,
  type ErrorResponseEnvelope,
  type MemoryCoreMethod,
  type MemoryCoreRequest,
  type MemoryCoreResponse,
  type MemoryCoreResponseMap,
} from "./contracts.js";
import { DomainError, toErrorEnvelope } from "./errors.js";
import {
  assertLocalOnlyPolicy,
  type LocalOnlyPolicyConfig,
} from "./localOnlyPolicy.js";
import { createSessionLifecycleService } from "./sessionLifecycleService.js";

const DEFAULT_EMBEDDING_DIMENSION = 32;

// Maximum length of a redactExisting preview entry. Previews are built from the
// REDACTED text (never the raw secret) and truncated so a long
// memory body cannot leak surrounding context in bulk.
const REDACT_PREVIEW_MAX_LENGTH = 120;

interface MemoryDto {
  id: string;
  projectId: string;
  sessionId: string;
  sourceAdapter: string;
  kind: string;
  content: string;
  normalizedContent: string;
  importance: number;
  embedding: string | null;
  embeddingDim: number | null;
  embeddingVersion: string | null;
  author: string;
  originProjectId: string | null;
  accessCount: number;
  lastAccessed: string | null;
  effectiveImportance: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolve the local OS username for author stamping, sanitized to a
 * filename-safe token and falling back to "" when unavailable. Mirrors
 * cli/context.localUsername but without a "user" fallback so the service can be
 * driven with an explicit username dep in tests.
 */
function resolveServiceUsername(explicit: string | undefined): string {
  if (explicit !== undefined) {
    return explicit;
  }
  try {
    return (userInfo().username ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  } catch {
    return "";
  }
}

interface RetrievedMemoryDto extends MemoryDto {
  semantic: number;
  score: RetrievedMemoryCandidate["score"];
}

export interface CreateMemoryCoreServiceDeps {
  db: Database;
  embeddingDimension?: number;
  /**
   * Local author identity stamped on every locally-authored write.
   * Defaults to the sanitized OS username; an explicit value is the test seam.
   */
  username?: string;
  policyConfig?: LocalOnlyPolicyConfig;
  /** Path to the policy config driving the session-end light prune. Test seam. */
  policyConfigPath?: string;
  /** Explicit retentionDays for the session-end light prune. Test seam. */
  retentionDaysOverride?: number;
  /** Clock seam for the session-end prune cutoff. */
  now?: () => Date;
  /** Injection seam for the session-end hard-delete (forces a throw in tests). */
  deleteOldMemories?: (
    db: Database,
    projectId: string,
    cutoffIso: string,
  ) => number;
}

type MethodResult<M extends MemoryCoreMethod> =
  | MemoryCoreResponse<M>
  | ErrorResponseEnvelope;

// Maximum content length serialized into an MCP retrieve response. The full
// content remains in the DB; this only caps what is returned to the tool caller
// so a large result set cannot overflow the agent context (100 rows × 10k chars
// ≈ 1MB JSON).
const RETRIEVE_CONTENT_MAX_LENGTH = 2000;

/**
 * Clamp an imported/pulled timestamp to server time. A record carrying a future
 * createdAt/updatedAt would otherwise be immune to retention pruning (its age
 * never crosses the cutoff), so any value past `serverNow` is pulled back to it.
 */
function clampDateToNow(date: string | null | undefined): string | null {
  if (!date) return null;
  const epochMs = Date.parse(date);
  if (isNaN(epochMs)) return null; // invalid date → discard
  const nowMs = Date.now();
  // Parse to epoch (handles timezone offsets correctly), clamp future dates to
  // now, and normalize to a canonical UTC ISO string (no timezone offset) so
  // lexicographic comparison in the retention prune stays consistent.
  return new Date(Math.min(epochMs, nowMs)).toISOString();
}

function toMemoryDto(record: MemoryRecord): MemoryDto {
  return {
    id: record.id,
    projectId: record.project_id,
    sessionId: record.session_id,
    sourceAdapter: record.source_adapter,
    kind: record.kind,
    content: record.content.slice(0, RETRIEVE_CONTENT_MAX_LENGTH),
    normalizedContent: record.normalized_content?.slice(0, RETRIEVE_CONTENT_MAX_LENGTH) ?? null,
    importance: record.importance,
    embedding: null,
    embeddingDim: record.embedding_dim,
    embeddingVersion: record.embedding_version,
    author: record.author,
    originProjectId: record.origin_project_id,
    accessCount: record.access_count,
    lastAccessed: record.last_accessed,
    effectiveImportance: computeEffectiveImportance(record.importance, record.access_count),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/**
 * Export/sync DTO: preserves FULL content and normalized_content, unlike
 * toMemoryDto which caps both at RETRIEVE_CONTENT_MAX_LENGTH (2000) to bound MCP
 * tool responses against context overflow. Export and team-push must round-trip
 * losslessly — importMemories/pullMemories re-embed from the exported `content`,
 * so truncating here would permanently lose any memory body over 2000 chars
 * (stored content can be up to MAX_CONTENT_LENGTH = 10000) on re-import.
 */
function toExportMemoryDto(record: MemoryRecord): MemoryDto {
  return {
    ...toMemoryDto(record),
    content: record.content,
    normalizedContent: record.normalized_content,
  };
}

function toRetrievedMemoryDto(record: RetrievedMemoryCandidate): RetrievedMemoryDto {
  return {
    id: record.id,
    projectId: record.project_id,
    sessionId: record.session_id,
    sourceAdapter: record.source_adapter,
    kind: record.kind,
    // Cap content for the MCP tool response to prevent context overflow; the
    // full content stays in the DB and is reachable via getMemory.
    content: record.content.slice(0, RETRIEVE_CONTENT_MAX_LENGTH),
    normalizedContent: record.normalized_content?.slice(0, RETRIEVE_CONTENT_MAX_LENGTH) ?? null,
    importance: record.importance,
    embedding: null,
    embeddingDim: record.embedding_dim,
    embeddingVersion: record.embedding_version,
    author: record.author,
    originProjectId: record.origin_project_id,
    accessCount: record.access_count,
    lastAccessed: null,
    effectiveImportance: computeEffectiveImportance(record.importance, record.access_count),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    semantic: record.semantic,
    score: record.score,
  };
}

function parseRequest<T>(schema: ZodType<T>, request: unknown): T {
  try {
    return schema.parse(request);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("VALIDATION", "Invalid request payload", error.issues);
    }
    throw error;
  }
}

function toErrorResponse(error: unknown): ErrorResponseEnvelope {
  return {
    ok: false,
    error: toErrorEnvelope(error),
  };
}

export function createMemoryCoreService(deps: CreateMemoryCoreServiceDeps) {
  assertLocalOnlyPolicy(deps.policyConfig ?? { localOnly: true });

  const dimension = deps.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSION;
  const { db } = deps;
  // Resolve the local author identity once per service instance.
  const localAuthor = resolveServiceUsername(deps.username);
  const policyConfigPath = deps.policyConfigPath ?? configFilePath();

  /**
   * Resolve the effective redactionEnabled flag using precedence
   * override (explicit per-request value) > config.json > default,
   * mirroring resolveRetentionDays in sessionLifecycleService. An explicit
   * `false` or `true` on the request always wins; omission falls back to
   * `~/.sessionmem/config.json`'s redactionEnabled.
   */
  function resolveRedactionEnabled(explicit: boolean | undefined): boolean {
    return resolvePolicySettings({
      override: explicit !== undefined ? { redactionEnabled: explicit } : undefined,
      config: readPolicyConfig(policyConfigPath),
    }).redactionEnabled;
  }
  const lifecycleService = createSessionLifecycleService({
    db,
    embeddingDimension: dimension,
    username: localAuthor,
    policyConfigPath: deps.policyConfigPath,
    retentionDaysOverride: deps.retentionDaysOverride,
    now: deps.now,
    deleteOldMemories: deps.deleteOldMemories,
  });

  const methods: {
    [M in MemoryCoreMethod]: (
      request: MemoryCoreRequest<M>,
    ) => Promise<MemoryCoreResponseMap[M]>;
  } = {
    async ingestSessionEvents(request) {
      const parsed = parseRequest(ingestSessionEventsRequestSchema, request);

      // Wrap the whole batch in a single transaction so a mid-loop failure rolls
      // back every insert (no partial ingestion). Inserts use INSERT OR IGNORE
      // on the (project_id, session_id, event_index) UNIQUE index, so the count
      // reflects rows actually written and re-ingestion is a no-op.
      // Redact each event's payload_json before persisting so secrets in tool
      // inputs/outputs never reach storage — same write-path guarantee as
      // storeMemory. Events carry no explicit redactionEnabled flag, so resolve
      // it from the policy config.
      const redactionEnabled = resolveRedactionEnabled(undefined);
      const ingest = db.transaction(() => {
        let written = 0;
        for (const event of parsed.events) {
          const redactedPayload = applyRedaction(event.payloadJson, {
            redactionEnabled,
          }).text;
          written += insertSessionEvent(db, {
            id: event.id,
            project_id: parsed.projectId,
            session_id: parsed.sessionId,
            event_index: event.eventIndex,
            event_type: event.eventType,
            payload_json: redactedPayload,
            created_at: event.createdAt,
          });
        }
        return written;
      });

      const ingested = ingest();

      return {
        ok: true,
        ingested,
      };
    },

    async summarizeSessionToMemory(request) {
      const parsed = parseRequest(summarizeSessionToMemoryRequestSchema, request);

      // Redact before embedding/persisting so secrets in the summary text never
      // reach storage and the embedding is computed on the redacted text — same
      // write-path guarantee as storeMemory. The request carries no explicit
      // redactionEnabled flag, so resolve it from the policy config.
      const redaction = applyRedaction(parsed.summary, {
        redactionEnabled: resolveRedactionEnabled(undefined),
      });
      const embedding = deterministicEmbed(redaction.text, dimension);

      upsertSessionSummaryMemory(db, {
        id: parsed.memoryId,
        project_id: parsed.projectId,
        session_id: parsed.sessionId,
        source_adapter: parsed.sourceAdapter,
        kind: "summary",
        content: redaction.text,
        normalized_content: embedding.normalizedText,
        importance: parsed.importance,
        embedding: JSON.stringify(embedding.vector),
        embedding_dim: embedding.dimension,
        embedding_version: embedding.embeddingVersion,
        author: localAuthor,
        origin_project_id: null,
      });

      return {
        ok: true,
        memoryId: parsed.memoryId,
      };
    },

    async handleSessionEnd(request) {
      const parsed = parseRequest(handleSessionEndRequestSchema, request);
      return lifecycleService.handleSessionEnd(parsed);
    },

    async storeMemory(request) {
      const parsed = parseRequest(storeMemoryRequestSchema, request);

      // Redact before embedding/persisting so secrets never reach storage and
      // the embedding is computed on the redacted text. warningCodes
      // reuse the existing redaction_partial_failure mechanism.
      const redaction = applyRedaction(parsed.content, {
        redactionEnabled: resolveRedactionEnabled(parsed.redactionEnabled),
      });
      const embedding = deterministicEmbed(redaction.text, dimension);

      // Per-session write soft limit: warn the caller when the session has
      // already accumulated SESSION_WRITE_SOFT_LIMIT memories so the agent
      // gets feedback to stop storing excessively. The write still proceeds.
      const warningCodes = [...redaction.warningCodes];
      const sessionCount = countMemoriesBySession(db, parsed.sessionId, parsed.projectId);
      if (sessionCount >= SESSION_WRITE_SOFT_LIMIT) {
        warningCodes.push("session_write_limit_warning");
      }

      insertMemory(db, {
        id: parsed.memoryId,
        project_id: parsed.projectId,
        session_id: parsed.sessionId,
        source_adapter: parsed.sourceAdapter,
        kind: parsed.kind,
        content: redaction.text,
        normalized_content: embedding.normalizedText,
        importance: parsed.importance,
        embedding: JSON.stringify(embedding.vector),
        embedding_dim: embedding.dimension,
        embedding_version: embedding.embeddingVersion,
        // Locally-authored row: stamp the local username; origin is null
        // because this row did not come from another project's store.
        author: localAuthor,
        origin_project_id: null,
      });

      const inserted = getMemoryRecordById(db, parsed.projectId, parsed.memoryId);
      if (!inserted) {
        throw new DomainError("INTERNAL", "Memory insert did not persist");
      }

      return {
        ok: true,
        // Single-record write echo-back: return the FULL stored body (uncapped),
        // mirroring getMemory's single-record read. A store response carries one
        // row bounded by MAX_CONTENT_LENGTH (10000), so it cannot overflow the
        // agent context the way a multi-row list can, and the caller may want to
        // verify the actual persisted (post-redaction) content. Contrast with
        // batchStoreMemory below, which keeps the cap because it returns many rows.
        memory: toExportMemoryDto(inserted),
        warningCodes,
      };
    },

    async retrieveMemories(request) {
      const parsed = parseRequest(retrieveMemoriesRequestSchema, request);
      const limit =
        parsed.depth === "deep" ? Math.min(parsed.limit * 2, DEEP_MODE_RETRIEVAL_CAP) : parsed.limit;
      const ranked = retrieveMemories({
        db,
        projectId: parsed.projectId,
        queryText: parsed.query,
        limit,
      });

      if (ranked.length > 0 && parsed.mode !== "on-demand") {
        // Only boost access counts for startup injection (mode='auto'), not for
        // explicit on-demand retrieval, so a mid-session lookup does not inflate
        // recall-frequency ranking.
        incrementAccessCounts(db, parsed.projectId, ranked.map((m) => m.id));
      }

      // Honor a user-configured injectionCap when present; otherwise
      // formatStartupInjection falls back to its built-in default cap.
      const injectionCap = readPolicyConfig(policyConfigPath).injectionCap;

      return {
        ok: true,
        memories: ranked.map(toRetrievedMemoryDto),
        total: ranked.length,
        startupInjection: formatStartupInjection(ranked, {
          localUsername: localAuthor,
          tokenCap: injectionCap,
        }),
      };
    },

    async listMemories(request) {
      const parsed = parseRequest(listMemoriesRequestSchema, request);
      const all = listMemoriesByProject(db, parsed.projectId);
      // Rows arrive ordered by updated_at DESC, so slicing keeps the most
      // recently touched memories. `total` reports the full count; a shorter
      // `memories` array signals the caller that the list was truncated.
      const limit = parsed.limit ?? LIST_MEMORIES_DEFAULT_LIMIT;
      const memories = all.slice(0, limit);

      return {
        ok: true,
        memories: memories.map(toMemoryDto),
        total: all.length,
      };
    },

    async getMemory(request) {
      const parsed = parseRequest(getMemoryRequestSchema, request);
      const memory = getMemoryRecordById(db, parsed.projectId, parsed.memoryId);

      if (!memory) {
        throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
      }

      return {
        ok: true,
        memory: toExportMemoryDto(memory),
      };
    },

    async forgetMemory(request) {
      const parsed = parseRequest(forgetMemoryRequestSchema, request);

      // Capture the memory's importance before deletion so we can record
      // it in the feedback table as an analytics signal.
      const existing = getMemoryRecordById(db, parsed.projectId, parsed.memoryId);

      const deleted = deleteMemoryById(db, parsed.projectId, parsed.memoryId);

      if (deleted === 0) {
        throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
      }

      // Record the explicit user deletion as feedback. The FK on
      // memory_feedback no longer cascades (migration 007), so this row
      // survives the memory deletion and serves as an analytics signal.
      insertMemoryFeedbackEvent(db, {
        memory_id: parsed.memoryId,
        feedback_type: "manual_delete",
        previous_importance: existing?.importance ?? 0,
        new_importance: 0,
      });

      return {
        ok: true,
      };
    },

    async exportMemories(request) {
      const parsed = parseRequest(exportMemoriesRequestSchema, request);
      const memories = listMemoriesByProject(db, parsed.projectId);

      return {
        ok: true,
        memories: memories.map(toExportMemoryDto),
      };
    },

    async importMemories(request) {
      const parsed = parseRequest(importMemoriesRequestSchema, request);

      // The upsert (upsertImportedMemory) reassigns project_id on ON CONFLICT(id).
      // Because `id` is a globally-unique PRIMARY KEY (not scoped by project_id),
      // a colliding id owned by a *different* project would otherwise be silently
      // overwritten and relocated. getMemoryOwnerProjectId resolves ownership per
      // id so we skip those rather than upsert them.

      // Aggregate redaction warnings across all imported records. A
      // Set de-duplicates the redaction_partial_failure code so the envelope
      // stays compact regardless of how many records tripped the same rule.
      const warningCodeSet = new Set<string>();
      const effectiveRedactionEnabled = resolveRedactionEnabled(
        parsed.redactionEnabled,
      );

      let imported = 0;
      let skippedCrossProject = 0;
      let skippedExisting = 0;

      // Wrap the whole batch in a single transaction so a mid-loop failure rolls
      // back every upsert (no partial import).
      const runImport = db.transaction(() => {
        for (const memory of parsed.memories) {
          const ownerProjectId = getMemoryOwnerProjectId(db, memory.id);
          if (ownerProjectId !== undefined) {
            if (ownerProjectId !== parsed.projectId) {
              // Another project already owns this id: skip rather than overwrite
              // and reassign ownership via ON CONFLICT(id).
              skippedCrossProject += 1;
            } else {
              // This project already owns this id: skip rather than overwrite the
              // existing memory's content/timestamps. Only brand-new ids import.
              skippedExisting += 1;
            }
            continue;
          }

          // Redact each record before embedding/upsert so secrets never persist
          // and the embedding reflects the redacted text.
          const redaction = applyRedaction(memory.content, {
            redactionEnabled: effectiveRedactionEnabled,
          });
          for (const code of redaction.warningCodes) {
            warningCodeSet.add(code);
          }

          const embedding = deterministicEmbed(redaction.text, dimension);
          upsertImportedMemory(db, {
            id: memory.id,
            project_id: parsed.projectId,
            session_id: memory.sessionId,
            source_adapter: memory.sourceAdapter,
            kind: memory.kind,
            content: redaction.text,
            normalized_content: embedding.normalizedText,
            importance: memory.importance,
            embedding: JSON.stringify(embedding.vector),
            embedding_dim: embedding.dimension,
            embedding_version: embedding.embeddingVersion,
            // Plain import (not a team pull): preserve an incoming author when
            // the export carried one, else stamp the local username so the row
            // is never left with an empty author. origin_project_id is carried
            // through when present, else null for locally-originating rows.
            author:
              memory.author && memory.author.trim() !== ""
                ? memory.author
                : localAuthor,
            origin_project_id: memory.originProjectId ?? null,
            created_at: clampDateToNow(memory.createdAt) ?? undefined,
            updated_at: clampDateToNow(memory.updatedAt) ?? undefined,
          });
          imported += 1;
        }
      });

      runImport();

      return {
        ok: true,
        imported,
        skippedCrossProject,
        skippedExisting,
        warningCodes: [...warningCodeSet],
      };
    },

    async pullMemories(request) {
      const parsed = parseRequest(pullMemoriesRequestSchema, request);

      // Structural twin of importMemories with three team-pull changes:
      //  - importance uses MAX(local, incoming) so a teammate can never lower a
      //    locally-boosted importance (last-write-wins on content but
      //    importance-preserving). upsertPulledMemory carries that merge.
      //  - author/origin_project_id are stamped from the incoming record's
      //    provenance so pulled rows carry the teammate's identity and
      //    their source project_id.
      //  - cross-project id collisions are skipped, exactly as import.

      const warningCodeSet = new Set<string>();
      const effectiveRedactionEnabled = resolveRedactionEnabled(
        parsed.redactionEnabled,
      );

      let pulledNew = 0;
      let pulledUpdated = 0;
      let skippedCrossProject = 0;

      // Wrap the whole batch in a single transaction so a mid-loop failure rolls
      // back every upsert (no partial pull).
      const runPull = db.transaction(() => {
        for (const memory of parsed.memories) {
          const ownerProjectId = getMemoryOwnerProjectId(db, memory.id);
          if (ownerProjectId !== undefined && ownerProjectId !== parsed.projectId) {
            skippedCrossProject += 1;
            continue;
          }

          // An id already owned by THIS project is an update; otherwise a
          // brand-new insert. Snapshotting per-id keeps the count correct even
          // when the same id appears across multiple teammate files.
          const isUpdate = ownerProjectId !== undefined;

          // Re-run redaction on every pulled record regardless of the
          // teammate's redaction setting (4th write path), then re-embed the
          // redacted text so secrets never persist and the embedding matches.
          const redaction = applyRedaction(memory.content, {
            redactionEnabled: effectiveRedactionEnabled,
          });
          for (const code of redaction.warningCodes) {
            warningCodeSet.add(code);
          }

          const embedding = deterministicEmbed(redaction.text, dimension);
          upsertPulledMemory(db, {
            id: memory.id,
            // LOCAL project_id so merged rows are retrievable in the pulling
            // user's project (Open Q4).
            project_id: parsed.projectId,
            session_id: memory.sessionId,
            source_adapter: memory.sourceAdapter,
            kind: memory.kind,
            content: redaction.text,
            normalized_content: embedding.normalizedText,
            importance: memory.importance,
            embedding: JSON.stringify(embedding.vector),
            embedding_dim: embedding.dimension,
            embedding_version: embedding.embeddingVersion,
            // Stamp the teammate's provenance. author falls back to the
            // local username only when the incoming record carries none.
            author:
              memory.author && memory.author.trim() !== ""
                ? memory.author
                : localAuthor,
            // origin_project_id records the record's source-machine project_id:
            // its explicit originProjectId if present, else the record's own
            // incoming projectId (Open Q4).
            origin_project_id: memory.originProjectId ?? memory.projectId,
            created_at: clampDateToNow(memory.createdAt) ?? undefined,
            updated_at: clampDateToNow(memory.updatedAt) ?? undefined,
          });

          if (isUpdate) {
            pulledUpdated += 1;
          } else {
            pulledNew += 1;
          }
        }
      });

      runPull();

      return {
        ok: true,
        pulledNew,
        pulledUpdated,
        skippedCrossProject,
        warningCodes: [...warningCodeSet],
      };
    },

    async pruneMemories(request) {
      const parsed = parseRequest(pruneMemoriesRequestSchema, request);

      // retentionDays <= 0 disables pruning entirely. A non-positive
      // window must never translate into a future cutoff that could delete
      // everything.
      if (parsed.retentionDays <= 0) {
        return { ok: true, deleted: 0, eligible: 0 };
      }

      const cutoffMs =
        Date.now() - parsed.retentionDays * 24 * 60 * 60 * 1000;
      // ISO-8601 UTC with millisecond precision matches the stored created_at
      // format (strftime('%Y-%m-%dT%H:%M:%fZ')), enabling lexicographic compare.
      const cutoffIso = new Date(cutoffMs).toISOString();

      const eligible = countMemoriesOlderThan(db, parsed.projectId, cutoffIso);

      if (parsed.dryRun) {
        return { ok: true, deleted: 0, eligible };
      }

      const deleted = deleteMemoriesOlderThan(db, parsed.projectId, cutoffIso);
      return { ok: true, deleted, eligible };
    },

    async redactExisting(request) {
      const parsed = parseRequest(redactExistingRequestSchema, request);

      // One-time scrub of pre-existing rows. Dry-run by default:
      // apply=false reports matches and previews but writes nothing.
      const memories = listMemoriesByProject(db, parsed.projectId);

      let matched = 0;
      let updated = 0;
      let skipped = 0;
      const previews: string[] = [];

      for (const memory of memories) {
        const redaction = applyRedaction(memory.content, {
          redactionEnabled: true,
        });

        // A "match" is a row whose content changes under the rule set.
        if (redaction.text === memory.content) {
          continue;
        }
        matched += 1;

        // Preview is built from the REDACTED text and length-bounded so no raw
        // secret is echoed and no large body leaks in bulk.
        // Truncate on Unicode code-point boundaries (Array.from
        // iterates by code point) rather than String.slice's UTF-16 code-unit
        // boundaries, so a multi-byte character (emoji, non-BMP) straddling
        // the limit isn't split into an unpaired surrogate.
        previews.push(
          Array.from(redaction.text).slice(0, REDACT_PREVIEW_MAX_LENGTH).join(""),
        );

        if (parsed.apply) {
          // Recompute the embedding on the redacted content so BOTH the stored
          // normalized_content AND the embedding vector track the scrub. Without
          // re-embedding, the vector would remain a hash of the pre-redaction
          // (secret-bearing) text — inconsistent with normalized_content and
          // still ranking against the un-redacted body in semantic retrieval,
          // defeating the purpose of the scrub.
          const embedding = deterministicEmbed(redaction.text, dimension);
          // A single row that was deleted concurrently between the
          // initial listMemoriesByProject snapshot and this update would
          // otherwise throw and abort the whole scrub, discarding the
          // scanned/matched/updated counts and previews accumulated so far
          // (and any prior updates already committed, since the loop is not
          // wrapped in a transaction). Catch per-row and report it as
          // skipped instead.
          try {
            updateMemoryContent(
              db,
              parsed.projectId,
              memory.id,
              redaction.text,
              embedding.normalizedText,
              {
                vector: embedding.vector,
                dimension: embedding.dimension,
                embeddingVersion: embedding.embeddingVersion,
              },
            );
            updated += 1;
          } catch {
            skipped += 1;
          }
        }
      }

      return {
        ok: true,
        scanned: memories.length,
        matched,
        updated,
        skipped,
        previews,
      };
    },

    async batchStoreMemory(request) {
      const parsed = parseRequest(batchStoreMemoryRequestSchema, request);

      const uniqueSessions = new Set(parsed.memories.map((m) => m.sessionId));
      const sessionOverLimit = new Set<string>();
      for (const sid of uniqueSessions) {
        const count = countMemoriesBySession(db, sid, parsed.projectId);
        if (count >= SESSION_WRITE_SOFT_LIMIT) {
          sessionOverLimit.add(sid);
        }
      }

      interface BatchResult {
        memoryId: string;
        ok: boolean;
        memory?: ReturnType<typeof toMemoryDto>;
        warningCodes?: string[];
        error?: string;
      }

      const results: BatchResult[] = [];
      let stored = 0;
      let failed = 0;

      // Validate each item individually before entering the transaction so
      // validation errors are reported per-item without aborting the whole batch.
      const validatedItems: {
        index: number;
        item: z.infer<typeof batchStoreMemoryItemSchema>;
      }[] = [];

      for (let i = 0; i < parsed.memories.length; i++) {
        const raw = parsed.memories[i];
        try {
          // The array items were already parsed by batchStoreMemoryRequestSchema,
          // but we re-validate with the item schema so per-item errors are
          // captured individually (e.g. if a caller bypasses the outer schema).
          const item = batchStoreMemoryItemSchema.parse(raw);
          validatedItems.push({ index: i, item });
        } catch (err) {
          results.push({
            memoryId: raw.memoryId ?? `<index-${i}>`,
            ok: false,
            error:
              err instanceof ZodError
                ? err.issues.map((issue) => issue.message).join("; ")
                : String(err),
          });
          failed += 1;
        }
      }

      // Wrap all valid inserts in a single SQLite transaction for atomicity
      // and performance (better-sqlite3 transactions avoid per-statement
      // fsync, making batch inserts significantly faster).
      if (validatedItems.length > 0) {
        const runTransaction = db.transaction(() => {
          for (const { item } of validatedItems) {
            // Each insert is guarded individually so a duplicate-id (or other
            // constraint) collision fails only that item instead of aborting the
            // whole batch. A SQLite constraint violation rolls back only the
            // current statement, not the surrounding transaction, so the loop can
            // continue and the transaction still commits the successful inserts.
            try {
              const redaction = applyRedaction(item.content, {
                redactionEnabled: resolveRedactionEnabled(item.redactionEnabled),
              });
              const embedding = deterministicEmbed(redaction.text, dimension);

              insertMemory(db, {
                id: item.memoryId,
                project_id: parsed.projectId,
                session_id: item.sessionId,
                source_adapter: item.sourceAdapter,
                kind: item.kind,
                content: redaction.text,
                normalized_content: embedding.normalizedText,
                importance: item.importance,
                embedding: JSON.stringify(embedding.vector),
                embedding_dim: embedding.dimension,
                embedding_version: embedding.embeddingVersion,
                author: localAuthor,
                origin_project_id: null,
              });

              const inserted = getMemoryRecordById(db, parsed.projectId, item.memoryId);
              if (!inserted) {
                throw new DomainError("INTERNAL", `Memory insert did not persist: ${item.memoryId}`);
              }

              const itemWarningCodes = [...redaction.warningCodes];
              if (sessionOverLimit.has(item.sessionId)) {
                itemWarningCodes.push("session_write_limit_warning");
              }

              results.push({
                memoryId: item.memoryId,
                ok: true,
                // Capped echo-back (unlike single-record storeMemory): a batch
                // returns up to MAX_BATCH_SIZE rows, so returning full content per
                // row could overflow the agent context (parallel to listMemories).
                // The caller already holds each original body; full content stays
                // in the DB and is reachable via getMemory.
                memory: toMemoryDto(inserted),
                warningCodes: itemWarningCodes,
              });
              stored += 1;
            } catch (err) {
              const code = (err as { code?: string }).code ?? "";
              const message = err instanceof Error ? err.message : String(err);
              const isConstraint =
                code.startsWith("SQLITE_CONSTRAINT") ||
                /constraint failed/i.test(message);
              if (!isConstraint) {
                // Unexpected (non-constraint) failure — abort the whole
                // transaction so we don't silently commit a corrupt partial batch.
                throw err;
              }
              results.push({
                memoryId: item.memoryId,
                ok: false,
                error: "duplicate id",
              });
              failed += 1;
            }
          }
        });

        runTransaction();
      }

      // Sort results back into original input order: validated items were
      // processed in order but failed items were pushed first. Re-sort by
      // the memoryId to maintain a predictable output. Since memoryIds are
      // unique, use the input array order as the canonical sort key.
      const inputOrder = new Map(
        parsed.memories.map((m, i) => [m.memoryId, i]),
      );
      results.sort(
        (a, b) =>
          (inputOrder.get(a.memoryId) ?? 0) - (inputOrder.get(b.memoryId) ?? 0),
      );

      return {
        ok: true as const,
        results,
        stored,
        failed,
      };
    },

    async stats(request) {
      const parsed = parseRequest(statsRequestSchema, request);
      const totalMemories = countAllMemoriesByProject(db, parsed.projectId);
      const totalSessionEvents = countAllSessionEvents(db, parsed.projectId);

      return {
        ok: true,
        totalMemories,
        totalSessionEvents,
      };
    },

    async resetAccessCounts(request) {
      const parsed = parseRequest(resetAccessCountsRequestSchema, request);
      const affected = resetAccessCounts(db, parsed.projectId);
      return {
        ok: true,
        affected,
      };
    },
  };

  async function call<M extends MemoryCoreMethod>(
    method: M,
    request: MemoryCoreRequest<M>,
  ): Promise<MethodResult<M>> {
    try {
      return await methods[method](request);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return {
    ...methods,
    call,
  };
}
