import type { Database } from "better-sqlite3";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import {
  deleteMemoriesOlderThan as deleteMemoriesOlderThanDefault,
  upsertSessionSummaryMemory,
} from "../storage/memoryRepo.js";
import {
  configFilePath,
  DEFAULT_POLICY_CONFIG,
  readPolicyConfig,
  resolvePolicySettings,
} from "../config/policyConfig.js";
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
const CLOUD_ENABLED_MESSAGE =
  "Cloud summarization active: allowCloudSummarization=true and ANTHROPIC_API_KEY present";

export interface SessionLifecycleServiceDeps {
  db: Database;
  embeddingDimension?: number;
  /** Local author identity stamped on session-summary writes (D-07). */
  username?: string;
  summarizeLocal?: (input: LocalSummarizeInput) => Promise<SummarizerResult>;
  summarizeCloud?: (input: CloudSummarizeInput) => Promise<SummarizerResult>;
  createFailureId?: () => string;
  /**
   * Path to the policy config used to resolve the effective retentionDays for
   * the session-end light prune. Defaults to {@link configFilePath}. Test seam.
   */
  policyConfigPath?: string;
  /**
   * Explicit retentionDays override. When provided it takes precedence over the
   * policy config (test seam so integration tests can drive the prune
   * deterministically without writing to the real `~/.sessionmem` config).
   */
  retentionDaysOverride?: number;
  /** Clock seam for computing the prune cutoff. Defaults to {@link Date}. */
  now?: () => Date;
  /**
   * Injection seam for the hard-delete. Defaults to the real
   * {@link deleteMemoriesOlderThanDefault}; tests force a throw to prove the
   * prune failure is swallowed (D-02 / T-06-14).
   */
  deleteOldMemories?: (
    db: Database,
    projectId: string,
    cutoffIso: string,
  ) => number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    author: string;
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
    // Session summaries are locally authored (D-07).
    author: input.author,
    origin_project_id: null,
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
  const author = deps.username ?? "";
  const policyConfigPath = deps.policyConfigPath ?? configFilePath();
  const now = deps.now ?? (() => new Date());
  const deleteOldMemories =
    deps.deleteOldMemories ?? deleteMemoriesOlderThanDefault;

  /**
   * Resolve the effective retentionDays for a session-end prune. An explicit
   * override wins (test seam); otherwise read the validated policy config, which
   * itself falls back to the 90-day default on any failure (T-06-15).
   */
  function resolveRetentionDays(): number {
    if (deps.retentionDaysOverride !== undefined) {
      return deps.retentionDaysOverride;
    }
    try {
      return readPolicyConfig(policyConfigPath).retentionDays;
    } catch {
      return DEFAULT_POLICY_CONFIG.retentionDays;
    }
  }

  /**
   * Resolve the effective redactionEnabled flag for the session-end
   * auto-summarize redaction step using precedence override (explicit
   * request.config.redactionEnabled) > config.json > default (D-11), mirroring
   * resolveRetentionDays. Falls back to the built-in default on any read
   * failure (T-06-15).
   */
  function resolveRedactionEnabled(explicit: boolean | undefined): boolean {
    try {
      return resolvePolicySettings({
        override: explicit !== undefined ? { redactionEnabled: explicit } : undefined,
        config: readPolicyConfig(policyConfigPath),
      }).redactionEnabled;
    } catch {
      return explicit ?? DEFAULT_POLICY_CONFIG.redactionEnabled;
    }
  }

  /**
   * D-02: light, non-blocking retention prune executed once at session-end.
   * Hard-deletes memories older than the effective retentionDays for this
   * project. retentionDays<=0 disables pruning (D-03). Any failure is swallowed
   * so it can never block or fail summarization (T-06-14).
   */
  function runLightPrune(projectId: string): void {
    try {
      const retentionDays = resolveRetentionDays();
      if (retentionDays <= 0) {
        return;
      }
      const cutoffMs = now().getTime() - retentionDays * MS_PER_DAY;
      // ISO-8601 UTC with millisecond precision matches the stored created_at
      // format (strftime('%Y-%m-%dT%H:%M:%fZ')) for lexicographic comparison.
      const cutoffIso = new Date(cutoffMs).toISOString();
      deleteOldMemories(deps.db, projectId, cutoffIso);
    } catch {
      // Light prune is best-effort: never block or fail summarization (D-02).
    }
  }

  async function handleSessionEnd(
    request: HandleSessionEndRequest,
  ): Promise<HandleSessionEndResponse> {
    const events = listSessionEventsBySession(
      deps.db,
      request.projectId,
      request.sessionId,
    );

    if (!request.config.autoSummarize) {
      runLightPrune(request.projectId);
      return {
        ok: true,
        status: "skipped_disabled",
        usedMode: "local",
        warningCodes: [],
        warningMessages: [],
      };
    }

    if (events.length < request.config.minimumEventThreshold) {
      runLightPrune(request.projectId);
      return {
        ok: true,
        status: "skipped_threshold",
        usedMode: "local",
        warningCodes: [],
        warningMessages: [],
      };
    }

    const mode = resolveSummarizerMode(request.config);
    const memoryId = buildMemoryId(request);
    const baseInput = {
      events,
      summaryTokenCap: request.config.summaryTokenCap,
      redactionEnabled: resolveRedactionEnabled(request.config.redactionEnabled),
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
          author,
        });

        runLightPrune(request.projectId);
        return {
          ok: true,
          status: "stored",
          usedMode: "cloud",
          warningCodes: [
            "cloud_summarization_enabled",
            ...cloudResult.warningCodes,
          ],
          warningMessages: [CLOUD_ENABLED_MESSAGE],
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
          author,
        });

        runLightPrune(request.projectId);
        return {
          ok: true,
          status: "stored",
          usedMode: "local",
          warningCodes: [
            "cloud_summarization_enabled",
            "cloud_fallback_to_local",
            ...fallbackResult.warningCodes,
          ],
          warningMessages: [
            CLOUD_ENABLED_MESSAGE,
            "Cloud summarization failed; fallback to local summarizer succeeded.",
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
          warningCodes: [
            "cloud_summarization_enabled",
            "cloud_fallback_to_local_failed",
          ],
          warningMessages: [
            CLOUD_ENABLED_MESSAGE,
            "Cloud summarization failed; local fallback also failed.",
          ],
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
        author,
      });

      runLightPrune(request.projectId);
      return {
        ok: true,
        status: "stored",
        usedMode: "local",
        warningCodes: localResult.warningCodes,
        warningMessages: [],
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
        warningMessages: [],
        failureRecordId,
      };
    }
  }

  return {
    handleSessionEnd,
  };
}
