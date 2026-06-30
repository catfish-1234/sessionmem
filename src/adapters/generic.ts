import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import type { HostAdapterContract, HostCapabilities, HostAdapterResult } from "./contract/hostAdapterContract.js";
import {
  batchStoreMemoryRequestSchema,
  forgetMemoryRequestSchema,
  getMemoryRequestSchema,
  handleSessionEndRequestSchema,
  ingestSessionEventsRequestSchema,
  listMemoriesRequestSchema,
  resetAccessCountsRequestSchema,
  retrieveMemoriesRequestSchema,
  statsRequestSchema,
  storeMemoryRequestSchema,
  summarizeSessionToMemoryRequestSchema,
  type MemoryCoreMethod,
  type MemoryCoreRequest,
} from "../core/api/contracts.js";
import { join } from "path";
import { createCliContext } from "../cli/context.js";
import { IDEInstaller } from "./ide/installer.js";
import { FallbackToolRegistrar } from "./capabilities/fallbackTools.js";
import { countStaleEmbeddings } from "../core/storage/memoryRepo.js";
import { EMBEDDING_VERSION } from "../core/embed/embeddingVersion.js";

/**
 * Diagnostic logging sink for the stdio server. CRITICAL: the MCP protocol
 * frames are written to STDOUT by StdioServerTransport, so anything this server
 * emits for humans MUST go to stderr — a stray console.log to stdout corrupts
 * the JSON-RPC stream and breaks every client.
 */
function logDiagnostic(message: string): void {
  process.stderr.write(`[sessionmem] ${message}\n`);
}

// Read the package version dynamically so the MCP server's advertised version
// tracks package.json on every release. A hardcoded literal silently drifts on
// `npm version` bumps (postversion does not rewrite source), so mirror ping.ts.
const require = createRequire(import.meta.url);
const SERVER_VERSION = (require("../../package.json") as { version: string }).version;

/**
 * Each MCP tool exposes one MemoryCoreMethod. The tool's input schema mirrors
 * the corresponding `*RequestSchema` from contracts.ts, MINUS `projectId`: the
 * project is resolved server-side from the host context (deriveProjectId), so
 * clients never have to supply it (and cannot target another project).
 */
interface ToolDefinition<M extends MemoryCoreMethod> {
  method: M;
  description: string;
  /** Raw zod shape (per-field) passed to registerTool's inputSchema. */
  inputShape: ZodRawShape;
  /** MCP annotation hints surfaced during protocol introspection. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * Strip `projectId` from a request schema's shape so the tool input only asks
 * the client for the fields it should provide; the server injects projectId.
 */
function shapeWithoutProjectId(shape: ZodRawShape): ZodRawShape {
  const { projectId: _projectId, ...rest } = shape;
  return rest;
}

/**
 * Resolve a default sessionId for tools that require one but were invoked
 * without it. Agents pass arbitrary/inconsistent sessionIds (or none), which
 * breaks the per-session soft-limit counter and handleSessionEnd correlation.
 * Preferring CLAUDE_CODE_SESSION_ID ties an agent's storeMemory/ingest calls to
 * the same Claude Code session the SessionStart hook ran under. Callers can
 * still override by supplying an explicit sessionId.
 */
// Evaluated once per process lifecycle so every storeMemory/ingest call in one
// MCP server process shares the same fallback session when no env session id is
// available. Computing `session-${Date.now()}` per call would hand each call a
// different fake session, breaking the per-session soft-limit counter and
// handleSessionEnd correlation.
const PROCESS_SESSION_FALLBACK = `session-${Date.now()}`;

function resolveDefaultSessionId(): string {
  return (
    process.env.CLAUDE_CODE_SESSION_ID ??
    process.env.SESSION_ID ??
    PROCESS_SESSION_FALLBACK
  );
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

const TOOL_DEFINITIONS: ToolDefinition<MemoryCoreMethod>[] = [
  {
    method: "retrieveMemories",
    description:
      "Semantically search stored memories and return the top matches ranked by a weighted combination of relevance, recency, and importance. Read-only; no side effects.\n\n" +
      "WHEN TO CALL: (1) At the start of every session — pass the current task or file as the query to pre-load relevant context. (2) Mid-session whenever a new topic, file, or decision area arises that may have prior context. Do NOT call on every user turn.\n\n" +
      "WHEN NOT TO CALL: If you already retrieved memories for this topic this session. Use getMemory if you have a specific memoryId. Use listMemories only to audit the full store, not for context loading.\n\n" +
      "Returns up to `limit` results (default 20). `mode='auto'` is the standard startup path; `mode='on-demand'` signals an explicit mid-session lookup. `depth='deep'` runs a broader semantic sweep at higher latency — use when the topic is unfamiliar. Phrase `query` as what you need to recall, not what you are about to do.\n\n" +
      "NOTE: this tool updates access-pattern counters on the memories it returns (used to boost frequently-recalled memories in future ranking), so it is NOT side-effect-free despite being a lookup.",
    // retrieveMemories mutates access_count on the rows it returns, so it is
    // not read-only and the previous idempotentHint was inaccurate.
    annotations: { readOnlyHint: false },
    inputShape: {
      query: retrieveMemoriesRequestSchema.shape.query.describe(
        "Natural-language description of what you need to recall. Phrase as a topic or question (e.g. 'database connection settings', 'auth flow decisions') — not an action ('store info about...')."
      ),
      limit: retrieveMemoriesRequestSchema.shape.limit.describe(
        "Maximum number of memories to return. Integer 1-100, default 20. Increase for broad topic sweeps; keep at default for focused lookups."
      ),
      mode: retrieveMemoriesRequestSchema.shape.mode.describe(
        "'auto' for the standard startup context-load path. 'on-demand' for an explicit mid-session retrieval triggered by a specific task or question."
      ),
      depth: retrieveMemoriesRequestSchema.shape.depth.describe(
        "'default' for standard semantic search. 'deep' for a broader sweep that surfaces less-similar memories — use when the topic is new or unfamiliar."
      ),
      tags: retrieveMemoriesRequestSchema.shape.tags.describe(
        "Optional tag filter. When provided, only return memories that have ALL listed tags."
      ),
    },
  },
  {
    method: "storeMemory",
    description:
      "Persist a single memory unit to the local SQLite store. Accepts decisions, facts, architectural choices, warnings, and session summaries. NOT idempotent — each call creates a new record even with identical content. Writes to disk immediately.\n\n" +
      "WHEN TO CALL: After any significant decision, discovery, or conclusion that should be available in a future session. Good candidates: technology choices, non-obvious constraints, bug root-causes, architectural decisions, key facts about the codebase.\n\n" +
      "WHEN NOT TO CALL: For trivial observations, transient state, or content that duplicates what was just retrieved. Do not store entire files or full conversation transcripts.\n\n" +
      "`kind` categories: 'decision', 'fact', 'summary', 'warning', 'preference'. Write `content` to be self-contained — it must be useful without any surrounding conversation context. `importance` 1-10 (10 = most critical); directly affects retrieval ranking in future sessions.\n\n" +
      "RESPONSE may include `warningCodes`: 'session_write_limit_warning' (this session has stored many memories — stop storing trivia and prefer batchStoreMemory) and 'redaction_partial_failure' (a redaction rule errored; the write still succeeded). Treat them as advisory signals, not errors.",
    annotations: { destructiveHint: false, idempotentHint: false },
    inputShape: {
      memoryId: storeMemoryRequestSchema.shape.memoryId.describe(
        "Caller-supplied unique UUID for this memory (e.g. crypto.randomUUID()). Used for deduplication and for later retrieval by ID via getMemory."
      ),
      sessionId: storeMemoryRequestSchema.shape.sessionId.describe(
        "Identifier for the current session. Used to group memories by session for diagnostics. Use a consistent ID within a single session."
      ),
      sourceAdapter: storeMemoryRequestSchema.shape.sourceAdapter.describe(
        "Name of the adapter or host creating this memory (e.g. 'claude-code', 'cursor', 'generic'). Used for provenance tracking."
      ),
      kind: storeMemoryRequestSchema.shape.kind.describe(
        "Category of this memory. One of: 'decision', 'fact', 'warning', 'preference', 'summary'. These are the only recognized kinds — others are rejected."
      ),
      content: storeMemoryRequestSchema.shape.content.describe(
        "The memory text. Must be self-contained and specific — written so it is useful without surrounding conversation context. Avoid vague phrases like 'the user decided to...'."
      ),
      importance: storeMemoryRequestSchema.shape.importance.describe(
        "Integer 1-10 indicating criticality (10 = most important). Directly affects ranking in future retrieveMemories calls. Use 8-10 for decisions that must not be forgotten; 3-5 for useful but non-critical facts."
      ),
      redactionEnabled: storeMemoryRequestSchema.shape.redactionEnabled.describe(
        "If true, PII is stripped from content before storage. Omit to use the project-level redaction setting from config.json."
      ),
      tags: storeMemoryRequestSchema.shape.tags.describe(
        "Optional array of tag strings (max 10, each max 50 chars) for categorizing this memory. Example: ['auth', 'db-schema']. Tags are filterable via retrieveMemories."
      ),
      expiresAt: storeMemoryRequestSchema.shape.expiresAt.describe(
        "Optional UTC ISO timestamp (e.g. '2026-12-31T00:00:00Z') after which this memory is excluded from retrieval. Use for time-limited context like a temporary workaround."
      ),
    },
  },
  {
    method: "listMemories",
    description:
      "Return every memory stored for the current project, unfiltered and without ranking. Read-only; no side effects.\n\n" +
      "WHEN TO CALL: When you need a complete inventory of stored memories — to audit what has been saved, detect duplicates, or build a full summary of all known context.\n\n" +
      "WHEN NOT TO CALL: For normal context loading at session start — use retrieveMemories instead, which ranks by relevance. listMemories returns the entire store unfiltered and can be very large.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputShape: shapeWithoutProjectId(listMemoriesRequestSchema.shape),
  },
  {
    method: "getMemory",
    description:
      "Fetch a single memory record by its exact ID. Returns the full record: content, kind, importance, timestamps, and session metadata. Read-only; no side effects.\n\n" +
      "WHEN TO CALL: When you already have a specific memoryId from a prior retrieveMemories or listMemories result and need its full detail.\n\n" +
      "WHEN NOT TO CALL: For topic-based search — use retrieveMemories for that. This tool requires an exact ID and does not search by content.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputShape: {
      memoryId: getMemoryRequestSchema.shape.memoryId.describe(
        "Exact UUID of the memory to fetch. Obtain from a prior retrieveMemories or listMemories result."
      ),
    },
  },
  {
    method: "forgetMemory",
    description:
      "Permanently delete a single memory by ID. The record is removed from the local SQLite store immediately and CANNOT be recovered. Destructive and irreversible.\n\n" +
      "WHEN TO CALL: Only when a memory is known to be incorrect, dangerously outdated, or a duplicate that would mislead future sessions.\n\n" +
      "WHEN NOT TO CALL: If there is any doubt. A memory that is merely old or low-relevance does not need deletion — retrieval ranking deprioritizes it automatically.",
    annotations: { destructiveHint: true, idempotentHint: false },
    inputShape: {
      memoryId: forgetMemoryRequestSchema.shape.memoryId.describe(
        "Exact UUID of the memory to permanently delete. Obtain from a prior listMemories or retrieveMemories call. Deletion is immediate and irreversible."
      ),
    },
  },
  {
    method: "stats",
    description:
      "Return aggregate statistics for the current project: total stored memory count and total ingested session event count. Read-only; no side effects.\n\n" +
      "WHEN TO CALL: For diagnostic or monitoring purposes — to confirm memories were stored after a session, check store health, or report usage numbers.\n\n" +
      "WHEN NOT TO CALL: As part of normal context loading. stats returns counts only, not content; use retrieveMemories to load actual context.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputShape: shapeWithoutProjectId(statsRequestSchema.shape),
  },
  {
    method: "resetAccessCounts",
    description:
      "Reset access-pattern counters for all memories in the current project. Sets access_count to 0 and clears last_accessed timestamps without deleting any memories. Useful after large refactors when old access patterns no longer reflect current relevance.\n\n" +
      "WHEN TO CALL: After major codebase restructuring, project pivots, or when access-boosted rankings no longer reflect current relevance.\n\n" +
      "WHEN NOT TO CALL: During normal operation — access patterns self-correct as usage shifts.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputShape: shapeWithoutProjectId(resetAccessCountsRequestSchema.shape),
  },
  {
    method: "batchStoreMemory",
    description:
      "Persist multiple memory units in a single atomic SQLite transaction. Significantly faster than calling storeMemory repeatedly for session-end writes of 10-20 memories.\n\n" +
      "WHEN TO CALL: At session end or whenever you have multiple memories to store at once. Reduces overhead from per-insert fsync by wrapping all writes in one transaction.\n\n" +
      "WHEN NOT TO CALL: For a single memory — use storeMemory instead. For imports from external files — use importMemories.\n\n" +
      "Each item in the `memories` array follows the same schema as storeMemory (memoryId, sessionId, sourceAdapter, kind, content, importance). Invalid items are reported individually; valid items are still stored atomically.\n\n" +
      "NOTE: the per-item `memory` echoed back in the response has its `content` truncated to 2000 characters (a batch can return many rows). The full body is still persisted — fetch it with getMemory if you need the complete text. (Single-record storeMemory echoes the full content.)",
    annotations: { destructiveHint: false, idempotentHint: false },
    inputShape: {
      memories: batchStoreMemoryRequestSchema.shape.memories.describe(
        "Array of memory objects to store. Each must include: memoryId (unique UUID), sessionId, sourceAdapter, kind, content (self-contained text), importance (1-10). Minimum 1 item, maximum 100.\n\n" +
          "Per-item results may include `warningCodes` (e.g. 'session_write_limit_warning', 'redaction_partial_failure') — advisory signals, not failures."
      ),
    },
  },
  {
    method: "ingestSessionEvents",
    description:
      "Push raw session events (tool calls, decisions, file edits, user turns) to sessionmem so they can be summarized at session end and counted toward token-savings analytics. Writes immediately, in a single transaction. Re-ingesting the same (sessionId, eventIndex) is a no-op, so retries are safe.\n\n" +
      "WHEN TO CALL: Periodically during a session (e.g. at task boundaries) to record what happened, OR in one batch shortly before the session ends. This is what powers automatic session-end summarization and `sessionmem savings`.\n\n" +
      "WHEN NOT TO CALL: For durable, individually-important facts/decisions — use storeMemory for those. Session events are transient raw material for summarization, not first-class memories.\n\n" +
      "Each event needs: id (unique), eventIndex (monotonic 0-based order within the session), eventType (e.g. 'tool_use', 'user_message'), payloadJson (a JSON string of the event body).\n\n" +
      "LIMITS: at most 500 events per call. For more than 500 events, call this tool multiple times in chunks — re-ingestion of already-stored events is safe (idempotent via the (project, session, eventIndex) UNIQUE index), so overlapping chunks never double-count.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputShape: shapeWithoutProjectId(ingestSessionEventsRequestSchema.shape),
  },
  {
    method: "summarizeSessionToMemory",
    description:
      "Store an agent-authored session summary as a durable 'summary' memory in one call. Upserts on memoryId, so calling it again with the same memoryId replaces the prior summary rather than duplicating it.\n\n" +
      "WHEN TO CALL: At session end when you have already written a concise summary of what was accomplished and want to persist it directly (the simpler alternative to handleSessionEnd's automatic summarization).\n\n" +
      "WHEN NOT TO CALL: When you want sessionmem to generate the summary from ingested session events — use handleSessionEnd for that. For non-summary facts/decisions use storeMemory.\n\n" +
      "Provide: memoryId (stable id for this session's summary), sessionId, sourceAdapter, summary (the text), importance (1-10; 7 is typical for summaries).",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputShape: shapeWithoutProjectId(
      summarizeSessionToMemoryRequestSchema.shape,
    ),
  },
  {
    method: "handleSessionEnd",
    description:
      "Run the full session-end pipeline: auto-summarize the session's ingested events into a durable memory (when enough events exist) and apply a light retention prune of stale memories. Idempotent on the summary memory (upsert by sessionId).\n\n" +
      "WHEN TO CALL: Once, at the very end of a session, after ingesting session events via ingestSessionEvents. Lets sessionmem generate and store the session summary for you.\n\n" +
      "WHEN NOT TO CALL: Mid-session, or when you have already written your own summary (use summarizeSessionToMemory instead). On Claude Code this also runs automatically via the installed SessionEnd hook, so calling it explicitly is usually unnecessary there.\n\n" +
      "Provide sessionId and sourceAdapter. `memoryId` (optional) pins the summary's id; omit to derive `${sessionId}-summary`. `config` (optional) tunes autoSummarize / minimumEventThreshold / cloud summarization; omit for sensible local-only defaults.\n\n" +
      "RESPONSE `status` is one of: 'stored', 'skipped_threshold' (too few events), 'skipped_disabled', 'failed'. `warningCodes` may carry cloud/local fallback signals.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputShape: shapeWithoutProjectId(handleSessionEndRequestSchema.shape),
  },
];

export class GenericMCPAdapter implements HostAdapterContract {
  name = "Generic MCP";

  /**
   * When true, the `startup_inject_memories` fallback tool is NOT registered.
   * Hosts that already inject prior context deterministically at session start
   * (e.g. Claude Code via its SessionStart hook) set this so the agent cannot
   * double-inject memories — calling the tool on top of the hook would duplicate
   * the injected content and double-count access_count increments.
   */
  protected suppressStartupInjectionTool = false;

  // The stdio server (startMcpServer) registers TOOLS only — it never calls
  // server.registerPrompt() or server.registerResource(). Advertising prompt or
  // resource support here would make FallbackToolRegistrar SKIP the
  // startup_inject_memories / fetch_memories tools (it only registers them when
  // the matching capability is absent), leaving the agent with no automatic
  // startup-injection path. Capabilities therefore reflect reality: tools only.
  // Host subclasses inherit this and MUST NOT re-enable prompts/resources unless
  // they actually register them on the server.
  capabilities: HostCapabilities = {
    supportsPrompts: false,
    supportsResources: false,
    supportsTools: true,
  };

  /**
   * Default agent-guidance target for an undetected/generic MCP host: a
   * project-local AGENTS.md (the emerging cross-tool standard). Host subclasses
   * override this with the file their agent actually reads at startup.
   */
  guidanceTargets(): string[] {
    return [join(process.cwd(), "AGENTS.md")];
  }

  /**
   * Fallback for hosts that aren't specifically detected: register sessionmem
   * in a project-local `.mcp.json` (the de-facto generic MCP config format).
   */
  async install(): Promise<boolean> {
    const configPath = join(process.cwd(), ".mcp.json");
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(process.cwd(), ".mcp.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }

  async call<M extends MemoryCoreMethod>(
    _method: M,
    _request: MemoryCoreRequest<M>,
  ): Promise<HostAdapterResult<M>> {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: "MCP server not initialized. Start with: sessionmem run",
      },
    } as HostAdapterResult<M>;
  }

  async startMcpServer(): Promise<void> {
    // Reuse the production CLI wiring: real DB path, migrations, resolved
    // projectId, and the env-override seams (SESSIONMEM_DB_PATH /
    // SESSIONMEM_PROJECT_ID) used for isolated integration tests.
    const ctx = createCliContext();
    const { service, projectId } = ctx;

    // Surface stale embeddings (e.g. after an EMBEDDING_VERSION bump) so the
    // operator knows semantic ranking has degraded to importance+recency for
    // those rows until `sessionmem re-embed` is run. Best-effort; to stderr only
    // so it can never corrupt the stdio protocol stream.
    try {
      const stale = countStaleEmbeddings(ctx.db, projectId, EMBEDDING_VERSION);
      if (stale > 0) {
        logDiagnostic(
          `${stale} memory(ies) have stale embeddings (version != ${EMBEDDING_VERSION}). ` +
            `Run \`sessionmem re-embed\` to restore full semantic ranking.`,
        );
      }
    } catch {
      // Never block server startup on a diagnostic query.
    }

    const server = new McpServer({
      name: "sessionmem",
      version: SERVER_VERSION,
    });

    for (const def of TOOL_DEFINITIONS) {
      server.registerTool(
        def.method,
        {
          description: def.description,
          inputSchema: def.inputShape,
          ...(def.annotations ? { annotations: def.annotations } : {}),
        },
        async (args: Record<string, unknown>) => {
          // Inject the server-resolved projectId; clients never set it.
          const enriched: Record<string, unknown> = { ...args, projectId };

          // Default a missing sessionId for tools that require one so the
          // per-session counters and session-end correlation stay consistent
          // even when the agent omits (or cannot supply) a stable sessionId.
          if ("sessionId" in def.inputShape && isMissing(enriched.sessionId)) {
            enriched.sessionId = resolveDefaultSessionId();
          }

          // batchStoreMemory carries sessionId per-item, not at the top level —
          // backfill each item that omitted it with a single shared default.
          if (def.method === "batchStoreMemory" && Array.isArray(enriched.memories)) {
            let sharedDefault: string | undefined;
            enriched.memories = (enriched.memories as unknown[]).map((entry) => {
              if (entry && typeof entry === "object" && isMissing((entry as Record<string, unknown>).sessionId)) {
                sharedDefault ??= resolveDefaultSessionId();
                return { ...(entry as Record<string, unknown>), sessionId: sharedDefault };
              }
              return entry;
            });
          }

          const request = enriched as MemoryCoreRequest<typeof def.method>;
          const result = await service.call(def.method, request);

          if (result.ok === false) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Error [${result.error.code}]: ${result.error.message}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        },
      );
    }

    // Register fallback tools for hosts that lack resource or prompt support.
    // These provide fetch_memories and startup_inject_memories as tool-based
    // alternatives, wired to the same service instance used by TOOL_DEFINITIONS.
    const fallbackTools = FallbackToolRegistrar.getFallbackTools(this.capabilities, {
      service,
      projectId,
    }).filter(
      (fallback) =>
        !(this.suppressStartupInjectionTool && fallback.name === "startup_inject_memories"),
    );
    for (const fallback of fallbackTools) {
      server.registerTool(
        fallback.name,
        { description: fallback.description, inputSchema: fallback.inputShape },
        async (args: Record<string, unknown>) => {
          const result = await fallback.execute(args);
          return { content: [{ type: "text" as const, text: result }] };
        },
      );
    }

    // Graceful shutdown: close the DB on SIGINT/SIGTERM so SQLite checkpoints
    // the WAL and releases its file handles cleanly before the process exits.
    const shutdown = () => {
      try {
        ctx.db.close();
      } catch {
        // best-effort; never block exit on a close failure
      }
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    logDiagnostic(`Starting Generic MCP server over stdio (project: ${projectId})`);
    await server.connect(new StdioServerTransport());
  }
}
