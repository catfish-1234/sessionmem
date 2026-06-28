import type {
  ErrorResponseEnvelope,
  MemoryCoreMethod,
  MemoryCoreRequest,
  MemoryCoreResponse,
} from "../../core/api/contracts.js";

export type HostAdapterResult<M extends MemoryCoreMethod> =
  | MemoryCoreResponse<M>
  | ErrorResponseEnvelope;

export interface HostCapabilities {
  supportsPrompts: boolean;
  supportsResources: boolean;
  supportsTools: boolean;
}

export interface HostAdapterContract {
  name: string;
  capabilities: HostCapabilities;
  call<M extends MemoryCoreMethod>(
    method: M,
    request: MemoryCoreRequest<M>,
  ): Promise<HostAdapterResult<M>>;
  install?(): Promise<boolean>;
  uninstall?(): Promise<boolean>;
  startMcpServer?(): Promise<void>;
  /**
   * Absolute paths to the host's agent-guidance file(s) (CLAUDE.md, AGENTS.md,
   * Cursor/Windsurf/Cline rule files, …) where the sessionmem instruction block
   * should be injected at install time so the agent automatically learns the MCP
   * exists and how to use it. Omit (or return []) to fall back to the global
   * Claude Code memory file.
   */
  guidanceTargets?(): string[];
}

export type HostAdapterContractMap = {
  [M in MemoryCoreMethod]: (
    request: MemoryCoreRequest<M>,
  ) => Promise<HostAdapterResult<M>>;
};
