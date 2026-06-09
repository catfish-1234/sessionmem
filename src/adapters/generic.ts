import type { HostAdapterContract, HostCapabilities, HostAdapterResult } from "./contract/hostAdapterContract.js";
import type { MemoryCoreMethod, MemoryCoreRequest } from "../core/api/contracts.js";

export class GenericMCPAdapter implements HostAdapterContract {
  name = "Generic MCP";
  
  capabilities: HostCapabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

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
    console.log(`Starting Generic MCP Server over stdio...`);
    // Will hook up to @modelcontextprotocol/sdk here
  }
}
