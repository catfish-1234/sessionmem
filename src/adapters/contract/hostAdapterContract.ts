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
}

export type HostAdapterContractMap = {
  [M in MemoryCoreMethod]: (
    request: MemoryCoreRequest<M>,
  ) => Promise<HostAdapterResult<M>>;
};
