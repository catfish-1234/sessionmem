import { createHash } from "node:crypto";

export type TranscriptHost = "claude-code" | "codex" | "cursor";
export type JsonObject = Record<string, unknown>;
export interface TranscriptRecord { value: JsonObject; line: number }
export interface CapturedEvent { id: string; eventType: string; payloadJson: string; createdAt?: string }
export interface Transcript {
  host: TranscriptHost;
  cwd?: string;
  sessionId: string;
  events: CapturedEvent[];
  malformed: boolean;
}

export function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : undefined;
}

export function stableId(...parts: string[]): string {
  return `transcript-${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export function createdAt(value: unknown): string | undefined {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function unsupported(host: TranscriptHost, detail: string): never {
  throw new Error(`unsupported format for ${host}: ${detail}`);
}
