import type { Database } from "better-sqlite3";
import { ZodError, type ZodType } from "zod";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { retrieveMemories } from "../retrieve/retrieveMemories.js";
import {
  insertMemory,
  listMemoriesByProject,
  upsertSessionSummaryMemory,
} from "../storage/memoryRepo.js";
import {
  insertSessionEvent,
  listSessionEventsBySession,
} from "../storage/sessionEventsRepo.js";
import type { MemoryRecord } from "../storage/types.js";
import {
  exportMemoriesRequestSchema,
  forgetMemoryRequestSchema,
  getMemoryRequestSchema,
  handleSessionEndRequestSchema,
  importMemoriesRequestSchema,
  ingestSessionEventsRequestSchema,
  listMemoriesRequestSchema,
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

const DEFAULT_EMBEDDING_DIMENSION = 32;

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
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryCoreServiceDeps {
  db: Database;
  embeddingDimension?: number;
  policyConfig?: LocalOnlyPolicyConfig;
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
    createdAt: record.created_at,
    updatedAt: record.updated_at,
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
        importance, embedding, embedding_dim, embedding_version, created_at, updated_at
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
      });

      return {
        ok: true,
        memoryId: parsed.memoryId,
      };
    },

    async handleSessionEnd(request) {
      const parsed = parseRequest(handleSessionEndRequestSchema, request);
      const eventCount = listSessionEventsBySession(
        db,
        parsed.projectId,
        parsed.sessionId,
      ).length;

      if (!parsed.config.autoSummarize) {
        return {
          ok: true,
          status: "skipped_disabled",
          usedMode: "local",
          warningCodes: [],
        };
      }

      if (eventCount < parsed.config.minimumEventThreshold) {
        return {
          ok: true,
          status: "skipped_threshold",
          usedMode: "local",
          warningCodes: [],
        };
      }

      const memoryId = parsed.memoryId ?? `${parsed.sessionId}-summary`;
      const summary = `Session ${parsed.sessionId} ended with ${eventCount} events.`;
      const embedding = deterministicEmbed(summary, dimension);

      upsertSessionSummaryMemory(db, {
        id: memoryId,
        project_id: parsed.projectId,
        session_id: parsed.sessionId,
        source_adapter: parsed.sourceAdapter,
        kind: "summary",
        content: summary,
        normalized_content: embedding.normalizedText,
        importance: 7,
        embedding: JSON.stringify(embedding.vector),
        embedding_dim: embedding.dimension,
        embedding_version: embedding.embeddingVersion,
      });

      return {
        ok: true,
        status: "stored",
        usedMode: "local",
        warningCodes: [],
        memoryId,
      };
    },

    async storeMemory(request) {
      const parsed = parseRequest(storeMemoryRequestSchema, request);
      const embedding = deterministicEmbed(parsed.content, dimension);

      insertMemory(db, {
        id: parsed.memoryId,
        project_id: parsed.projectId,
        session_id: parsed.sessionId,
        source_adapter: parsed.sourceAdapter,
        kind: parsed.kind,
        content: parsed.content,
        normalized_content: embedding.normalizedText,
        importance: parsed.importance,
        embedding: JSON.stringify(embedding.vector),
        embedding_dim: embedding.dimension,
        embedding_version: embedding.embeddingVersion,
      });

      const inserted = getMemoryById(db, parsed.projectId, parsed.memoryId);
      if (!inserted) {
        throw new DomainError("INTERNAL", "Memory insert did not persist");
      }

      return {
        ok: true,
        memory: toMemoryDto(inserted),
      };
    },

    async retrieveMemories(request) {
      const parsed = parseRequest(retrieveMemoriesRequestSchema, request);
      const ranked = retrieveMemories({
        db,
        projectId: parsed.projectId,
        queryText: parsed.query,
        limit: parsed.limit,
      });

      return {
        ok: true,
        memories: ranked.map(toMemoryDto),
        total: ranked.length,
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
          importance, embedding, embedding_dim, embedding_version, created_at, updated_at
        ) VALUES (
          @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
          @importance, @embedding, @embedding_dim, @embedding_version,
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
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `);

      for (const memory of parsed.memories) {
        const embedding = deterministicEmbed(memory.content, dimension);
        stmt.run({
          id: memory.id,
          project_id: parsed.projectId,
          session_id: memory.sessionId,
          source_adapter: memory.sourceAdapter,
          kind: memory.kind,
          content: memory.content,
          normalized_content: embedding.normalizedText,
          importance: memory.importance,
          embedding: JSON.stringify(embedding.vector),
          embedding_dim: embedding.dimension,
          embedding_version: embedding.embeddingVersion,
          created_at: memory.createdAt,
          updated_at: memory.updatedAt,
        });
      }

      return {
        ok: true,
        imported: parsed.memories.length,
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
