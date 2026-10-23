import type {
  MemoryCoreResponseMap, StoreMemoryRequest, RetrieveMemoriesRequest,
} from "../core/api/contracts.js";

export type SearchMemoryIndexInput = Pick<RetrieveMemoriesRequest, "query" | "tags" | "includeHistory" | "scope" | "scopeMode"> & { limit?: number };
export type MemoryTimelineInput = { limit?: number; includeHistory?: boolean; scope?: string | null } & (
  { memoryId: string; fromDate?: never; toDate?: never }
  | { memoryId?: never; fromDate: string; toDate: string }
);
export type StoreMemoryInput = Omit<StoreMemoryRequest, "projectId">;

export class SessionmemApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "SessionmemApiError";
  }
}

/** Fetch only, with no Node imports or runtime dependencies. One server project. */
export class SessionmemClient {
  private readonly baseUrl: URL;
  constructor(baseUrl = "http://127.0.0.1:3778", private readonly options: { token?: string } = {}) {
    this.baseUrl = new URL(baseUrl);
  }

  private async request<T>(path: string, method = "GET", input?: object): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (method === "GET" && input) {
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, key === "scope" && item === null ? "" : String(item));
      }
    }
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(this.options.token === undefined ? {} : { Authorization: `Bearer ${this.options.token}` }),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new SessionmemApiError(response.status, result.error?.code ?? "HTTP_ERROR", result.error?.message ?? `HTTP ${response.status}`);
    return result as T;
  }

  searchMemoryIndex(input: SearchMemoryIndexInput): Promise<MemoryCoreResponseMap["searchMemoryIndex"]> {
    return this.request("/v1/search", "GET", input);
  }
  memoryTimeline(input: MemoryTimelineInput): Promise<MemoryCoreResponseMap["memoryTimeline"]> {
    return this.request("/v1/timeline", "GET", input);
  }
  getMemory(memoryId: string, input?: { scope?: string | null }): Promise<MemoryCoreResponseMap["getMemory"]> {
    return this.request(`/v1/memories/${encodeURIComponent(memoryId)}`, "GET", input);
  }
  storeMemory(input: StoreMemoryInput): Promise<MemoryCoreResponseMap["storeMemory"]> {
    return this.request("/v1/memories", "POST", input);
  }
  forgetMemory(memoryId: string): Promise<MemoryCoreResponseMap["forgetMemory"]> {
    return this.request(`/v1/memories/${encodeURIComponent(memoryId)}`, "DELETE");
  }
}
