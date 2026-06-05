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
    method: M,
    request: MemoryCoreRequest<M>,
  ): Promise<HostAdapterResult<M>> {
    // Stub for now. Real implementation maps to MemoryCore.
    throw new Error("Method not implemented.");
  }

  async startMcpServer(): Promise<void> {
    console.log(`Starting Generic MCP Server over stdio...`);
    // Will hook up to @modelcontextprotocol/sdk here
  }
}
