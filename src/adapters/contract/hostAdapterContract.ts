import type {
  ErrorResponseEnvelope,
  MemoryCoreMethod,
  MemoryCoreRequest,
  MemoryCoreResponse,
} from "../../core/api/contracts.js";

export type HostAdapterResult<M extends MemoryCoreMethod> =
  | MemoryCoreResponse<M>
  | ErrorResponseEnvelope;

export interface HostAdapterContract {
  call<M extends MemoryCoreMethod>(
    method: M,
    request: MemoryCoreRequest<M>,
  ): Promise<HostAdapterResult<M>>;
}

export type HostAdapterContractMap = {
  [M in MemoryCoreMethod]: (
    request: MemoryCoreRequest<M>,
  ) => Promise<HostAdapterResult<M>>;
};
