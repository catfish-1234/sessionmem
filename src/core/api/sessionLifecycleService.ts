import type { Database } from "better-sqlite3";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { upsertSessionSummaryMemory } from "../storage/memoryRepo.js";
import { listSessionEventsBySession } from "../storage/sessionEventsRepo.js";
import { insertSummarizationFailure } from "../storage/summarizationFailuresRepo.js";
import type {
  HandleSessionEndRequest,
  HandleSessionEndResponse,
} from "./contracts.js";
import { summarizeWithCloud, type CloudSummarizeInput } from "../summarize/cloudSummarizer.js";
import {
  summarizeLocalSessionEvents,
  type LocalSummarizeInput,
  type SummarizerResult,
} from "../summarize/localSummarizer.js";
import { resolveSummarizerMode } from "../summarize/strategySelector.js";

const DEFAULT_EMBEDDING_DIMENSION = 32;

interface LifecycleRetryConfig {
  retries: number;
}

const CLOUD_RETRY_CONFIG: LifecycleRetryConfig = {
  retries: 2,
};

export interface SessionLifecycleServiceDeps {
  db: Database;
  embeddingDimension?: number;
  summarizeLocal?: (input: LocalSummarizeInput) => Promise<SummarizerResult>;
  summarizeCloud?: (input: CloudSummarizeInput) => Promise<SummarizerResult>;
  createFailureId?: () => string;
}

function defaultFailureId(): string {
  return `sumfail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toErrorJson(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify({
      message: error.message,
      name: error.name,
    });
  }
  return JSON.stringify({ message: "Unknown error" });
}

async function retryCloud(
  fn: () => Promise<SummarizerResult>,
): Promise<SummarizerResult> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= CLOUD_RETRY_CONFIG.retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > CLOUD_RETRY_CONFIG.retries) {
        break;
      }
    }
  }

  throw lastError;
}

function storeSummaryMemory(
  db: Database,
  embeddingDimension: number,
  input: {
    memoryId: string;
    projectId: string;
    sessionId: string;
    sourceAdapter: string;
    summary: string;
  },
): void {
  const embedding = deterministicEmbed(input.summary, embeddingDimension);
  upsertSessionSummaryMemory(db, {
    id: input.memoryId,
    project_id: input.projectId,
    session_id: input.sessionId,
    source_adapter: input.sourceAdapter,
    kind: "summary",
    content: input.summary,
    normalized_content: embedding.normalizedText,
    importance: 7,
    embedding: JSON.stringify(embedding.vector),
    embedding_dim: embedding.dimension,
    embedding_version: embedding.embeddingVersion,
  });
}

function buildMemoryId(request: HandleSessionEndRequest): string {
  return request.memoryId ?? `${request.sessionId}-summary`;
}

export function createSessionLifecycleService(deps: SessionLifecycleServiceDeps) {
  const summarizeLocal = deps.summarizeLocal ?? summarizeLocalSessionEvents;
  const summarizeCloud = deps.summarizeCloud ?? summarizeWithCloud;
  const embeddingDimension =
    deps.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSION;
  const createFailureId = deps.createFailureId ?? defaultFailureId;

  async function handleSessionEnd(
    request: HandleSessionEndRequest,
  ): Promise<HandleSessionEndResponse> {
    const events = listSessionEventsBySession(
      deps.db,
      request.projectId,
      request.sessionId,
    );

    if (!request.config.autoSummarize) {
      return {
        ok: true,
        status: "skipped_disabled",
        usedMode: "local",
        warningCodes: [],
      };
    }

    if (events.length < request.config.minimumEventThreshold) {
      return {
        ok: true,
        status: "skipped_threshold",
        usedMode: "local",
        warningCodes: [],
      };
    }

    const mode = resolveSummarizerMode(request.config);
    const memoryId = buildMemoryId(request);
    const baseInput = {
      events,
      summaryTokenCap: request.config.summaryTokenCap,
      redactionEnabled: request.config.redactionEnabled,
      factMode: request.config.factMode,
    };

    if (mode === "cloud") {
      try {
        const cloudResult = await retryCloud(() =>
          summarizeCloud({
            ...baseInput,
            anthropicApiKey: request.config.anthropicApiKey ?? "",
          }),
        );
        storeSummaryMemory(deps.db, embeddingDimension, {
          memoryId,
          projectId: request.projectId,
          sessionId: request.sessionId,
          sourceAdapter: request.sourceAdapter,
          summary: cloudResult.summary,
        });

        return {
          ok: true,
          status: "stored",
          usedMode: "cloud",
          warningCodes: cloudResult.warningCodes,
          memoryId,
        };
      } catch {
        // fall back to local summarizer
      }

      try {
        const fallbackResult = await summarizeLocal(baseInput);
        storeSummaryMemory(deps.db, embeddingDimension, {
          memoryId,
          projectId: request.projectId,
          sessionId: request.sessionId,
          sourceAdapter: request.sourceAdapter,
          summary: fallbackResult.summary,
        });

        return {
          ok: true,
          status: "stored",
          usedMode: "local",
          warningCodes: [
            "cloud_fallback_to_local",
            ...fallbackResult.warningCodes,
          ],
          memoryId,
        };
      } catch (localError) {
        const failureRecordId = createFailureId();
        insertSummarizationFailure(deps.db, {
          id: failureRecordId,
          project_id: request.projectId,
          session_id: request.sessionId,
          source_adapter: request.sourceAdapter,
          reason: "cloud_and_local_failed",
          attempt_count: CLOUD_RETRY_CONFIG.retries + 2,
          last_error_json: toErrorJson(localError),
        });

        return {
          ok: true,
          status: "failed",
          usedMode: "local",
          warningCodes: ["cloud_fallback_to_local_failed"],
          failureRecordId,
        };
      }
    }

    try {
      const localResult = await summarizeLocal(baseInput);
      storeSummaryMemory(deps.db, embeddingDimension, {
        memoryId,
        projectId: request.projectId,
        sessionId: request.sessionId,
        sourceAdapter: request.sourceAdapter,
        summary: localResult.summary,
      });

      return {
        ok: true,
        status: "stored",
        usedMode: "local",
        warningCodes: localResult.warningCodes,
        memoryId,
      };
    } catch (error) {
      const failureRecordId = createFailureId();
      insertSummarizationFailure(deps.db, {
        id: failureRecordId,
        project_id: request.projectId,
        session_id: request.sessionId,
        source_adapter: request.sourceAdapter,
        reason: "local_failed",
        attempt_count: 1,
        last_error_json: toErrorJson(error),
      });

      return {
        ok: true,
        status: "failed",
        usedMode: "local",
        warningCodes: ["local_summarization_failed"],
        failureRecordId,
      };
    }
  }

  return {
    handleSessionEnd,
  };
}
