import { userInfo } from "node:os";
import type { Database } from "better-sqlite3";
import { ZodError, type ZodType } from "zod";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { retrieveMemories } from "../retrieve/retrieveMemories.js";
import { applyRedaction } from "../summarize/redaction.js";
import type { RetrievedMemoryCandidate } from "../retrieve/retrieveMemories.js";
import {
  countMemoriesOlderThan,
  deleteMemoriesOlderThan,
  insertMemory,
  listMemoriesByProject,
  recordUse,
  updateMemoryContent,
  upsertSessionSummaryMemory,
} from "../storage/memoryRepo.js";
import {
  configFilePath,
  readPolicyConfig,
  resolvePolicySettings,
} from "../config/policyConfig.js";
import { insertSessionEvent } from "../storage/sessionEventsRepo.js";
import type { MemoryRecord } from "../storage/types.js";
import {
  exportMemoriesRequestSchema,
  forgetMemoryRequestSchema,
  getMemoryRequestSchema,
  handleSessionEndRequestSchema,
  importMemoriesRequestSchema,
  pullMemoriesRequestSchema,
  ingestSessionEventsRequestSchema,
  listMemoriesRequestSchema,
  pruneMemoriesRequestSchema,
  recordMemoryUsedRequestSchema,
  redactExistingRequestSchema,
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
// REDACTED text (never the raw secret per D-07/D-14) and truncated so a long
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
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolve the local OS username for author stamping (D-07), sanitized to a
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
   * Local author identity stamped on every locally-authored write (D-07).
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

function toMemoryDto(record: MemoryRecord): MemoryDto {
  return {
    id: record.id,
    projectId: record.project_id,
    sessionId: record.session_id,
    sourceAdapter: record.source_adapter,
    kind: record.kind,
    content: record.content,
    normalizedContent: record.normalized_content,
    importance: record.importance,
    embedding: record.embedding,
    embeddingDim: record.embedding_dim,
    embeddingVersion: record.embedding_version,
    author: record.author,
    originProjectId: record.origin_project_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function toRetrievedMemoryDto(record: RetrievedMemoryCandidate): RetrievedMemoryDto {
  return {
    id: record.id,
    projectId: record.project_id,
    sessionId: record.session_id,
    sourceAdapter: record.source_adapter,
    kind: record.kind,
    content: record.content,
    normalizedContent: record.normalized_content,
    importance: record.importance,
    embedding: null,
    embeddingDim: record.embedding_dim,
    embeddingVersion: record.embedding_version,
    author: record.author,
    originProjectId: record.origin_project_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    semantic: record.semantic,
    score: record.score,
  };
}

function getMemoryById(
  db: Database,
  projectId: string,
  memoryId: string,
): MemoryRecord | undefined {
  const row = db
    .prepare(
      `
      SELECT
        id, project_id, session_id, source_adapter, kind, content, normalized_content,
        importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
        created_at, updated_at
      FROM memories
      WHERE project_id = ? AND id = ?
      LIMIT 1
    `,
    )
    .get(projectId, memoryId) as MemoryRecord | undefined;

  return row;
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
  // Resolve the local author identity once per service instance (D-07).
  const localAuthor = resolveServiceUsername(deps.username);
  const policyConfigPath = deps.policyConfigPath ?? configFilePath();

  /**
   * Resolve the effective redactionEnabled flag using precedence
   * override (explicit per-request value) > config.json > default (D-11),
   * mirroring resolveRetentionDays in sessionLifecycleService. An explicit
   * `false` or `true` on the request always wins; omission falls back to
   * `~/.sessionmem/config.json`'s redactionEnabled (CR-01).
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

      for (const event of parsed.events) {
        insertSessionEvent(db, {
          id: event.id,
          project_id: parsed.projectId,
          session_id: parsed.sessionId,
          event_index: event.eventIndex,
          event_type: event.eventType,
          payload_json: event.payloadJson,
          created_at: event.createdAt,
        });
      }

      return {
        ok: true,
        ingested: parsed.events.length,
      };
    },

    async summarizeSessionToMemory(request) {
      const parsed = parseRequest(summarizeSessionToMemoryRequestSchema, request);
      const embedding = deterministicEmbed(parsed.summary, dimension);

      upsertSessionSummaryMemory(db, {
        id: parsed.memoryId,
        project_id: parsed.projectId,
        session_id: parsed.sessionId,
        source_adapter: parsed.sourceAdapter,
        kind: "summary",
        content: parsed.summary,
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
      // the embedding is computed on the redacted text (D-06). warningCodes
      // reuse the existing redaction_partial_failure mechanism (D-08).
      const redaction = applyRedaction(parsed.content, {
        redactionEnabled: resolveRedactionEnabled(parsed.redactionEnabled),
      });
      const embedding = deterministicEmbed(redaction.text, dimension);

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
        // Locally-authored row: stamp the local username (D-07); origin is null
        // because this row did not come from another project's store.
        author: localAuthor,
        origin_project_id: null,
      });

      const inserted = getMemoryById(db, parsed.projectId, parsed.memoryId);
      if (!inserted) {
        throw new DomainError("INTERNAL", "Memory insert did not persist");
      }

      return {
        ok: true,
        memory: toMemoryDto(inserted),
        warningCodes: redaction.warningCodes,
      };
    },

    async retrieveMemories(request) {
      const parsed = parseRequest(retrieveMemoriesRequestSchema, request);
      const limit =
        parsed.depth === "deep" ? Math.min(parsed.limit * 2, 100) : parsed.limit;
      const ranked = retrieveMemories({
        db,
        projectId: parsed.projectId,
        queryText: parsed.query,
        limit,
      });

      return {
        ok: true,
        memories: ranked.map(toRetrievedMemoryDto),
        total: ranked.length,
      };
    },

    async recordMemoryUsed(request) {
      const parsed = parseRequest(recordMemoryUsedRequestSchema, request);
      const result = recordUse(db, {
        project_id: parsed.projectId,
        memory_id: parsed.memoryId,
        feedback_type: parsed.feedbackType,
        used_at: parsed.usedAt,
      });

      return {
        ok: true,
        memoryId: result.memory_id,
        previousImportance: result.previous_importance,
        newImportance: result.new_importance,
      };
    },

    async listMemories(request) {
      const parsed = parseRequest(listMemoriesRequestSchema, request);
      const memories = listMemoriesByProject(db, parsed.projectId);

      return {
        ok: true,
        memories: memories.map(toMemoryDto),
        total: memories.length,
      };
    },

    async getMemory(request) {
      const parsed = parseRequest(getMemoryRequestSchema, request);
      const memory = getMemoryById(db, parsed.projectId, parsed.memoryId);

      if (!memory) {
        throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
      }

      return {
        ok: true,
        memory: toMemoryDto(memory),
      };
    },

    async forgetMemory(request) {
      const parsed = parseRequest(forgetMemoryRequestSchema, request);
      const result = db
        .prepare("DELETE FROM memories WHERE project_id = ? AND id = ?")
        .run(parsed.projectId, parsed.memoryId);

      if (result.changes === 0) {
        throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
      }

      return {
        ok: true,
      };
    },

    async exportMemories(request) {
      const parsed = parseRequest(exportMemoriesRequestSchema, request);
      const memories = listMemoriesByProject(db, parsed.projectId);

      return {
        ok: true,
        memories: memories.map(toMemoryDto),
      };
    },

    async importMemories(request) {
      const parsed = parseRequest(importMemoriesRequestSchema, request);

      const stmt = db.prepare(`
        INSERT INTO memories (
          id, project_id, session_id, source_adapter, kind, content, normalized_content,
          importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
          created_at, updated_at
        ) VALUES (
          @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
          @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
          COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          source_adapter = excluded.source_adapter,
          kind = excluded.kind,
          content = excluded.content,
          normalized_content = excluded.normalized_content,
          importance = excluded.importance,
          embedding = excluded.embedding,
          embedding_dim = excluded.embedding_dim,
          embedding_version = excluded.embedding_version,
          author = excluded.author,
          origin_project_id = excluded.origin_project_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `);

      // CR-02: `id` is a globally-unique PRIMARY KEY (not scoped by
      // project_id). The upsert above reassigns `project_id = excluded.project_id`
      // on conflict, which would let an imported record silently overwrite and
      // relocate another project's memory if its `id` happens to collide.
      // Look up existing ownership per id and skip (rather than upsert) any
      // record whose id already belongs to a *different* project.
      const ownerStmt = db.prepare(
        "SELECT project_id FROM memories WHERE id = ?",
      );

      // Aggregate redaction warnings across all imported records (D-08). A
      // Set de-duplicates the redaction_partial_failure code so the envelope
      // stays compact regardless of how many records tripped the same rule.
      const warningCodeSet = new Set<string>();
      const effectiveRedactionEnabled = resolveRedactionEnabled(
        parsed.redactionEnabled,
      );

      let imported = 0;
      let skippedCrossProject = 0;

      for (const memory of parsed.memories) {
        const owner = ownerStmt.get(memory.id) as
          | { project_id: string }
          | undefined;
        if (owner && owner.project_id !== parsed.projectId) {
          // Another project already owns this id: skip rather than overwrite
          // and reassign ownership via ON CONFLICT(id).
          skippedCrossProject += 1;
          continue;
        }

        // Redact each record before embedding/upsert so secrets never persist
        // and the embedding reflects the redacted text (D-06).
        const redaction = applyRedaction(memory.content, {
          redactionEnabled: effectiveRedactionEnabled,
        });
        for (const code of redaction.warningCodes) {
          warningCodeSet.add(code);
        }

        const embedding = deterministicEmbed(redaction.text, dimension);
        stmt.run({
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
          // Plain import (not a team pull): preserve an incoming author when the
          // export carried one, else stamp the local username so the row is
          // never left with an empty author (D-07). origin_project_id is carried
          // through when present, else null for locally-originating rows.
          author:
            memory.author && memory.author.trim() !== ""
              ? memory.author
              : localAuthor,
          origin_project_id: memory.originProjectId ?? null,
          created_at: memory.createdAt,
          updated_at: memory.updatedAt,
        });
        imported += 1;
      }

      return {
        ok: true,
        imported,
        skippedCrossProject,
        warningCodes: [...warningCodeSet],
      };
    },

    async pullMemories(request) {
      const parsed = parseRequest(pullMemoriesRequestSchema, request);

      // Structural twin of importMemories with three team-pull changes:
      //  - importance uses MAX(local, incoming) so a teammate can never lower a
      //    locally-boosted importance (D-11, last-write-wins on content but
      //    importance-preserving).
      //  - author/origin_project_id are stamped from the incoming record's
      //    provenance (D-06) so pulled rows carry the teammate's identity and
      //    their source project_id.
      //  - cross-project id collisions are skipped (D-09), exactly as import.
      const stmt = db.prepare(`
        INSERT INTO memories (
          id, project_id, session_id, source_adapter, kind, content, normalized_content,
          importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
          created_at, updated_at
        ) VALUES (
          @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
          @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
          COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          source_adapter = excluded.source_adapter,
          kind = excluded.kind,
          content = excluded.content,
          normalized_content = excluded.normalized_content,
          -- D-11: importance-preserving merge. better-sqlite3@12 bundles a
          -- SQLite that accepts the two-arg scalar MAX() inside DO UPDATE; the
          -- pull-merge importance-preserve test verifies both directions.
          importance = MAX(memories.importance, excluded.importance),
          embedding = excluded.embedding,
          embedding_dim = excluded.embedding_dim,
          embedding_version = excluded.embedding_version,
          author = excluded.author,
          origin_project_id = excluded.origin_project_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `);

      // D-09: same cross-project ownership skip as importMemories. A colliding
      // id owned by a different project is skipped, never overwritten/relocated.
      const ownerStmt = db.prepare(
        "SELECT project_id FROM memories WHERE id = ?",
      );

      const warningCodeSet = new Set<string>();
      const effectiveRedactionEnabled = resolveRedactionEnabled(
        parsed.redactionEnabled,
      );

      let pulledNew = 0;
      let pulledUpdated = 0;
      let skippedCrossProject = 0;

      for (const memory of parsed.memories) {
        const owner = ownerStmt.get(memory.id) as
          | { project_id: string }
          | undefined;
        if (owner && owner.project_id !== parsed.projectId) {
          skippedCrossProject += 1;
          continue;
        }

        // D-16: an id already owned by THIS project is an update; otherwise a
        // brand-new insert. Snapshotting per-id via ownerStmt keeps the count
        // correct even when the same id appears across multiple teammate files.
        const isUpdate = owner !== undefined;

        // D-12: re-run redaction on every pulled record regardless of the
        // teammate's redaction setting (4th write path), then re-embed the
        // redacted text so secrets never persist and the embedding matches.
        const redaction = applyRedaction(memory.content, {
          redactionEnabled: effectiveRedactionEnabled,
        });
        for (const code of redaction.warningCodes) {
          warningCodeSet.add(code);
        }

        const embedding = deterministicEmbed(redaction.text, dimension);
        stmt.run({
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
          // D-06: stamp the teammate's provenance. author falls back to the
          // local username only when the incoming record carries none.
          author:
            memory.author && memory.author.trim() !== ""
              ? memory.author
              : localAuthor,
          // origin_project_id records the record's source-machine project_id:
          // its explicit originProjectId if present, else the record's own
          // incoming projectId (Open Q4).
          origin_project_id: memory.originProjectId ?? memory.projectId,
          created_at: memory.createdAt,
          updated_at: memory.updatedAt,
        });

        if (isUpdate) {
          pulledUpdated += 1;
        } else {
          pulledNew += 1;
        }
      }

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

      // retentionDays <= 0 disables pruning entirely (D-03). A non-positive
      // window must never translate into a future cutoff that could delete
      // everything (T-06-07).
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

      // One-time scrub of pre-existing rows (D-07). Dry-run by default (D-14):
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
        // secret is echoed and no large body leaks in bulk (T-06-10, D-07/D-14).
        // IN-01: truncate on Unicode code-point boundaries (Array.from
        // iterates by code point) rather than String.slice's UTF-16 code-unit
        // boundaries, so a multi-byte character (emoji, non-BMP) straddling
        // the limit isn't split into an unpaired surrogate.
        previews.push(
          Array.from(redaction.text).slice(0, REDACT_PREVIEW_MAX_LENGTH).join(""),
        );

        if (parsed.apply) {
          // Recompute the embedding-normalized text on the redacted content so
          // the stored normalized_content stays consistent with the scrub.
          const embedding = deterministicEmbed(redaction.text, dimension);
          // WR-03: a single row that was deleted concurrently between the
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

    async stats(request) {
      const parsed = parseRequest(statsRequestSchema, request);
      const memoryCount = db
        .prepare("SELECT COUNT(*) AS count FROM memories WHERE project_id = ?")
        .get(parsed.projectId) as { count: number };
      const sessionEventCount = db
        .prepare("SELECT COUNT(*) AS count FROM session_events WHERE project_id = ?")
        .get(parsed.projectId) as { count: number };

      return {
        ok: true,
        totalMemories: memoryCount.count,
        totalSessionEvents: sessionEventCount.count,
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
