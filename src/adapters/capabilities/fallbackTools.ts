import type { HostCapabilities } from "../contract/hostAdapterContract.js";

export class FallbackToolRegistrar {
  static getFallbackTools(capabilities: HostCapabilities) {
    const tools = [];

    if (!capabilities.supportsResources) {
      tools.push({
        name: "fetch_memories",
        description: "Fallback tool to fetch memories because host lacks MCP resource support.",
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
        description: "Fallback tool to manually request startup injection because host lacks MCP prompt support.",
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
