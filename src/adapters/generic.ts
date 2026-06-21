import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import type { HostAdapterContract, HostCapabilities, HostAdapterResult } from "./contract/hostAdapterContract.js";
import {
  batchStoreMemoryRequestSchema,
  forgetMemoryRequestSchema,
  getMemoryRequestSchema,
  listMemoriesRequestSchema,
  retrieveMemoriesRequestSchema,
  statsRequestSchema,
  storeMemoryRequestSchema,
  type MemoryCoreMethod,
  type MemoryCoreRequest,
} from "../core/api/contracts.js";
import { join } from "path";
import { createCliContext } from "../cli/context.js";
import { IDEInstaller } from "./ide/installer.js";

/**
 * Diagnostic logging sink for the stdio server. CRITICAL: the MCP protocol
 * frames are written to STDOUT by StdioServerTransport, so anything this server
 * emits for humans MUST go to stderr — a stray console.log to stdout corrupts
 * the JSON-RPC stream and breaks every client.
 */
function logDiagnostic(message: string): void {
  process.stderr.write(`[sessionmem] ${message}\n`);
}

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

const TOOL_DEFINITIONS: ToolDefinition<MemoryCoreMethod>[] = [
  {
    method: "retrieveMemories",
    description:
      "Semantically search stored memories and return the top matches ranked by a weighted combination of relevance, recency, and importance. Read-only; no side effects.\n\n" +
      "WHEN TO CALL: (1) At the start of every session — pass the current task or file as the query to pre-load relevant context. (2) Mid-session whenever a new topic, file, or decision area arises that may have prior context. Do NOT call on every user turn.\n\n" +
      "WHEN NOT TO CALL: If you already retrieved memories for this topic this session. Use getMemory if you have a specific memoryId. Use listMemories only to audit the full store, not for context loading.\n\n" +
      "Returns up to `limit` results (default 20). `mode='auto'` is the standard startup path; `mode='on-demand'` signals an explicit mid-session lookup. `depth='deep'` runs a broader semantic sweep at higher latency — use when the topic is unfamiliar. Phrase `query` as what you need to recall, not what you are about to do.",
    annotations: { readOnlyHint: true, idempotentHint: true },
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
    },
  },
  {
    method: "storeMemory",
    description:
      "Persist a single memory unit to the local SQLite store. Accepts decisions, facts, architectural choices, warnings, and session summaries. NOT idempotent — each call creates a new record even with identical content. Writes to disk immediately.\n\n" +
      "WHEN TO CALL: After any significant decision, discovery, or conclusion that should be available in a future session. Good candidates: technology choices, non-obvious constraints, bug root-causes, architectural decisions, key facts about the codebase.\n\n" +
      "WHEN NOT TO CALL: For trivial observations, transient state, or content that duplicates what was just retrieved. Do not store entire files or full conversation transcripts.\n\n" +
      "`kind` categories: 'decision', 'fact', 'summary', 'warning', 'architecture'. Write `content` to be self-contained — it must be useful without any surrounding conversation context. `importance` 1-10 (10 = most critical); directly affects retrieval ranking in future sessions.",
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
        "Category of this memory. Recommended values: 'decision', 'fact', 'summary', 'warning', 'architecture'. Any non-empty string is valid."
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
    method: "batchStoreMemory",
    description:
      "Persist multiple memory units in a single atomic SQLite transaction. Significantly faster than calling storeMemory repeatedly for session-end writes of 10-20 memories.\n\n" +
      "WHEN TO CALL: At session end or whenever you have multiple memories to store at once. Reduces overhead from per-insert fsync by wrapping all writes in one transaction.\n\n" +
      "WHEN NOT TO CALL: For a single memory — use storeMemory instead. For imports from external files — use importMemories.\n\n" +
      "Each item in the `memories` array follows the same schema as storeMemory (memoryId, sessionId, sourceAdapter, kind, content, importance). Invalid items are reported individually; valid items are still stored atomically.",
    annotations: { destructiveHint: false, idempotentHint: false },
    inputShape: {
      memories: batchStoreMemoryRequestSchema.shape.memories.describe(
        "Array of memory objects to store. Each must include: memoryId (unique UUID), sessionId, sourceAdapter, kind, content (self-contained text), importance (1-10). Minimum 1 item."
      ),
    },
  },
];

export class GenericMCPAdapter implements HostAdapterContract {
  name = "Generic MCP";

  capabilities: HostCapabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

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

    const server = new McpServer({
      name: "sessionmem",
      version: "1.0.0",
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
          const request = { ...args, projectId } as MemoryCoreRequest<
            typeof def.method
          >;
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

    logDiagnostic(`Starting Generic MCP server over stdio (project: ${projectId})`);
    await server.connect(new StdioServerTransport());
  }
}
