import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import type { HostAdapterContract, HostCapabilities, HostAdapterResult } from "./contract/hostAdapterContract.js";
import {
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
      "Retrieve the most relevant stored memories for a semantic query, ranked by relevance, recency, and importance.",
    inputShape: shapeWithoutProjectId(retrieveMemoriesRequestSchema.shape),
  },
  {
    method: "storeMemory",
    description:
      "Store a memory (decision, fact, summary, or warning) for the current project.",
    inputShape: shapeWithoutProjectId(storeMemoryRequestSchema.shape),
  },
  {
    method: "listMemories",
    description: "List all stored memories for the current project.",
    inputShape: shapeWithoutProjectId(listMemoriesRequestSchema.shape),
  },
  {
    method: "getMemory",
    description: "Fetch a single stored memory by its ID.",
    inputShape: shapeWithoutProjectId(getMemoryRequestSchema.shape),
  },
  {
    method: "forgetMemory",
    description: "Delete a stored memory by its ID.",
    inputShape: shapeWithoutProjectId(forgetMemoryRequestSchema.shape),
  },
  {
    method: "stats",
    description:
      "Report memory statistics (total memories and session events) for the current project.",
    inputShape: shapeWithoutProjectId(statsRequestSchema.shape),
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
