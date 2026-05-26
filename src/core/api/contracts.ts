import { z } from "zod";
import type { DomainErrorCode } from "./errors.js";

export const memorySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  kind: z.string().min(1),
  content: z.string().min(1),
  normalizedContent: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  embedding: z.string().nullable(),
  embeddingDim: z.number().int().nullable(),
  embeddingVersion: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ingestSessionEventSchema = z.object({
  id: z.string().min(1),
  eventIndex: z.number().int().nonnegative(),
  eventType: z.string().min(1),
  payloadJson: z.string().min(1),
  createdAt: z.string().min(1).optional(),
});

export const ingestSessionEventsRequestSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  events: z.array(ingestSessionEventSchema).min(1),
});

export const summarizeSessionToMemoryRequestSchema = z.object({
  memoryId: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(10),
});

export const factModeSchema = z.enum([
  "summary-only",
  "facts-only",
  "summary+facts",
]);

export const handleSessionEndConfigSchema = z.object({
  autoSummarize: z.boolean().default(true),
  minimumEventThreshold: z.number().int().min(1).max(100).default(3),
  summaryTokenCap: z.number().int().min(1).default(300),
  redactionEnabled: z.boolean().default(true),
  factMode: factModeSchema.default("summary+facts"),
  allowCloudSummarization: z.boolean().default(false),
  anthropicApiKey: z.string().min(1).optional(),
});

export const handleSessionEndRequestSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  memoryId: z.string().min(1).optional(),
  config: handleSessionEndConfigSchema.default({}),
});

export const storeMemoryRequestSchema = z.object({
  memoryId: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  kind: z.string().min(1),
  content: z.string().min(1),
  importance: z.number().int().min(1).max(10),
});

export const retrieveMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const listMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
});

export const getMemoryRequestSchema = z.object({
  projectId: z.string().min(1),
  memoryId: z.string().min(1),
});

export const forgetMemoryRequestSchema = z.object({
  projectId: z.string().min(1),
  memoryId: z.string().min(1),
});

export const exportMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
});

export const importMemoryRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  kind: z.string().min(1),
  content: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
});

export const importMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
  memories: z.array(importMemoryRecordSchema),
});

export const statsRequestSchema = z.object({
  projectId: z.string().min(1),
});

export const operationResultSchema = z.object({
  ok: z.literal(true),
});

export const singleMemoryResponseSchema = z.object({
  ok: z.literal(true),
  memory: memorySchema,
});

export const memoryListResponseSchema = z.object({
  ok: z.literal(true),
  memories: z.array(memorySchema),
  total: z.number().int().nonnegative(),
});

export const exportMemoriesResponseSchema = z.object({
  ok: z.literal(true),
  memories: z.array(memorySchema),
});

export const statsResponseSchema = z.object({
  ok: z.literal(true),
  totalMemories: z.number().int().nonnegative(),
  totalSessionEvents: z.number().int().nonnegative(),
});

export const ingestSessionEventsResponseSchema = z.object({
  ok: z.literal(true),
  ingested: z.number().int().nonnegative(),
});

export const summarizeSessionToMemoryResponseSchema = z.object({
  ok: z.literal(true),
  memoryId: z.string().min(1),
});

export const handleSessionEndResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["stored", "skipped_threshold", "skipped_disabled", "failed"]),
  usedMode: z.enum(["local", "cloud"]),
  warningCodes: z.array(z.string()),
  warningMessages: z.array(z.string()),
  failureRecordId: z.string().min(1).optional(),
  memoryId: z.string().min(1).optional(),
});

export const importMemoriesResponseSchema = z.object({
  ok: z.literal(true),
  imported: z.number().int().nonnegative(),
});

export interface ErrorResponseEnvelope {
  ok: false;
  error: {
    code: DomainErrorCode;
    message: string;
    details?: unknown;
  };
}

export type IngestSessionEventsRequest = z.infer<
  typeof ingestSessionEventsRequestSchema
>;
export type SummarizeSessionToMemoryRequest = z.infer<
  typeof summarizeSessionToMemoryRequestSchema
>;
export type HandleSessionEndRequest = z.infer<
  typeof handleSessionEndRequestSchema
>;
export type StoreMemoryRequest = z.infer<typeof storeMemoryRequestSchema>;
export type RetrieveMemoriesRequest = z.infer<typeof retrieveMemoriesRequestSchema>;
export type ListMemoriesRequest = z.infer<typeof listMemoriesRequestSchema>;
export type GetMemoryRequest = z.infer<typeof getMemoryRequestSchema>;
export type ForgetMemoryRequest = z.infer<typeof forgetMemoryRequestSchema>;
export type ExportMemoriesRequest = z.infer<typeof exportMemoriesRequestSchema>;
export type ImportMemoriesRequest = z.infer<typeof importMemoriesRequestSchema>;
export type StatsRequest = z.infer<typeof statsRequestSchema>;

export type IngestSessionEventsResponse = z.infer<
  typeof ingestSessionEventsResponseSchema
>;
export type SummarizeSessionToMemoryResponse = z.infer<
  typeof summarizeSessionToMemoryResponseSchema
>;
export type HandleSessionEndResponse = z.infer<
  typeof handleSessionEndResponseSchema
>;
export type StoreMemoryResponse = z.infer<typeof singleMemoryResponseSchema>;
export type RetrieveMemoriesResponse = z.infer<typeof memoryListResponseSchema>;
export type ListMemoriesResponse = z.infer<typeof memoryListResponseSchema>;
export type GetMemoryResponse = z.infer<typeof singleMemoryResponseSchema>;
export type ForgetMemoryResponse = z.infer<typeof operationResultSchema>;
export type ExportMemoriesResponse = z.infer<typeof exportMemoriesResponseSchema>;
export type ImportMemoriesResponse = z.infer<typeof importMemoriesResponseSchema>;
export type StatsResponse = z.infer<typeof statsResponseSchema>;

export interface MemoryCoreRequestMap {
  ingestSessionEvents: IngestSessionEventsRequest;
  summarizeSessionToMemory: SummarizeSessionToMemoryRequest;
  handleSessionEnd: HandleSessionEndRequest;
  storeMemory: StoreMemoryRequest;
  retrieveMemories: RetrieveMemoriesRequest;
  listMemories: ListMemoriesRequest;
  getMemory: GetMemoryRequest;
  forgetMemory: ForgetMemoryRequest;
  exportMemories: ExportMemoriesRequest;
  importMemories: ImportMemoriesRequest;
  stats: StatsRequest;
}

export interface MemoryCoreResponseMap {
  ingestSessionEvents: IngestSessionEventsResponse;
  summarizeSessionToMemory: SummarizeSessionToMemoryResponse;
  handleSessionEnd: HandleSessionEndResponse;
  storeMemory: StoreMemoryResponse;
  retrieveMemories: RetrieveMemoriesResponse;
  listMemories: ListMemoriesResponse;
  getMemory: GetMemoryResponse;
  forgetMemory: ForgetMemoryResponse;
  exportMemories: ExportMemoriesResponse;
  importMemories: ImportMemoriesResponse;
  stats: StatsResponse;
}

export type MemoryCoreMethod = keyof MemoryCoreRequestMap;
export type MemoryCoreRequest<M extends MemoryCoreMethod> = MemoryCoreRequestMap[M];
export type MemoryCoreResponse<M extends MemoryCoreMethod> = MemoryCoreResponseMap[M];
