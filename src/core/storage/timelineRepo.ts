import type { Database } from "better-sqlite3";
import { DomainError } from "../api/errors.js";

interface TimelineRow { id: string; content: string; kind: string; created_at: string }
interface TimelineInput {
  scope?: string | null;
  projectId: string; memoryId?: string; fromDate?: string; toDate?: string; includeHistory: boolean; limit: number;
}

/** Small SQL projections, stable ordering, and no access-count writes. */
export function memoryTimeline(db: Database, input: TimelineInput, now: Date): { rows: TimelineRow[]; hasMore: boolean } {
  const visible = `project_id = @projectId AND (expires_at IS NULL OR expires_at > @now)
    ${input.scope !== undefined ? "AND scope IS @scope" : ""}
    AND (@history = 1 OR id NOT IN (SELECT memory_id FROM superseded_memories))`;
  const bindings = { projectId: input.projectId, now: now.toISOString(), history: Number(input.includeHistory), scope: input.scope ?? null };
  // Project only enough text for the one-line summary, never embeddings or bodies.
  const select = `SELECT id, substr(content, 1, 1000) AS content, kind, created_at FROM memories WHERE ${visible}`;
  if (!input.memoryId) {
    const rows = db.prepare(`${select} AND created_at >= @fromDate AND created_at <= @toDate
      ORDER BY created_at, id LIMIT @limit`).all({ ...bindings,
      fromDate: new Date(input.fromDate!).toISOString(), toDate: new Date(input.toDate!).toISOString(), limit: input.limit + 1,
    }) as TimelineRow[];
    return { rows: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
  }
  const anchor = db.prepare(`${select} AND id = @memoryId`).get({ ...bindings, memoryId: input.memoryId }) as TimelineRow | undefined;
  if (!anchor) throw new DomainError("NOT_FOUND", `Memory not found: ${input.memoryId}`);
  const params = { ...bindings, date: anchor.created_at, id: anchor.id, limit: input.limit + 1 };
  const before = db.prepare(`${select} AND (created_at < @date OR (created_at = @date AND id < @id))
    ORDER BY created_at DESC, id DESC LIMIT @limit`).all(params) as TimelineRow[];
  const after = db.prepare(`${select} AND (created_at > @date OR (created_at = @date AND id > @id))
    ORDER BY created_at, id LIMIT @limit`).all(params) as TimelineRow[];
  const left = Math.min(before.length, Math.max(Math.floor((input.limit - 1) / 2), input.limit - 1 - after.length));
  const right = Math.min(after.length, input.limit - 1 - left);
  return { rows: [...before.slice(0, left).reverse(), anchor, ...after.slice(0, right)],
    hasMore: before.length + after.length + 1 > input.limit };
}
