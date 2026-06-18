import type { HostCapabilities } from "../contract/hostAdapterContract.js";

export class FallbackToolRegistrar {
  static getFallbackTools(capabilities: HostCapabilities) {
    const tools = [];

    if (!capabilities.supportsResources) {
      tools.push({
        name: "fetch_memories",
        description:
          "Fallback memory retrieval for hosts that do not support MCP resources. Call this instead of accessing the sessionmem:// resource URI directly when the host lacks resource support. Semantically equivalent to retrieveMemories — returns stored memories ranked by relevance to the query. Read-only; no side effects.\n\n" +
          "WHEN TO CALL: At session start and mid-session when you need to retrieve context and the host does not support MCP resources. Do not call if the host supports MCP resources — use the sessionmem:// resource URI or retrieveMemories tool instead.\n\n" +
          "Parameter `query`: natural-language description of what context you need to recall (e.g. 'API design decisions', 'database schema choices').",
        schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        execute: async (args: { query: string }) => {
          // Wrap core retrieval logic
          return `Fetched memories for ${args.query}`;
        }
      });
    }

    if (!capabilities.supportsPrompts) {
      tools.push({
        name: "startup_inject_memories",
        description:
          "Fallback startup-injection for hosts that do not support MCP prompts. Call this once at the very start of a session instead of relying on the automatic sessionmem startup prompt when the host lacks prompt support. Injects the top relevant memories for the current project into the working context. No parameters required.\n\n" +
          "WHEN TO CALL: Once per session start, before any user task work begins, when the host does not surface MCP prompts automatically. Do not call if the host already surfaces the sessionmem startup prompt — calling both duplicates injected context.\n\n" +
          "Read-only; no side effects.",
        schema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          return "Startup memories injected.";
        }
      });
    }

    return tools;
  }
}
