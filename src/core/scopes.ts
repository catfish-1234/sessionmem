import { basename, resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { Database } from "better-sqlite3";
import { z } from "zod";

export const scopeLabelSchema = z.string().trim().min(1).max(160)
  // eslint-disable-next-line no-control-regex -- labels must remain single-line metadata
  .regex(/^[^\x00-\x1f\x7f]+$/, "scope must not contain control characters");
export const scopeSchema = scopeLabelSchema.nullable().optional();
export interface ScopeFilter { scope: string | null }
export interface ScopeSelection { scope?: string | null; scopeMode?: "filter" | "boost" }

/** A directory name, never its full path. Project IDs are the headless fallback. */
export function detectScope(workingDirectory?: string, projectId?: string): string | null {
  if (workingDirectory) {
    let path = resolve(workingDirectory);
    try { path = realpathSync(path); } catch { /* Deleted/offline workspaces still have a useful name. */ }
    const parsed = scopeLabelSchema.safeParse(basename(path));
    if (parsed.success) return parsed.data;
  }
  const parsed = scopeLabelSchema.safeParse(projectId);
  return parsed.success ? parsed.data : null;
}

export function captureScope(db: Database, projectId: string, sessionId: string,
  explicit: string | null | undefined, workingDirectory?: string, defaultScope?: string | null): string | null {
  if (explicit !== undefined) return explicit;
  const session = db.prepare("SELECT scope FROM sessions WHERE project_id = ? AND session_id = ?")
    .get(projectId, sessionId) as { scope: string | null } | undefined;
  return session ? session.scope : defaultScope !== undefined ? defaultScope : detectScope(workingDirectory, projectId);
}

export function recordSessionScope(db: Database, projectId: string, sessionId: string, scope: string | null): void {
  db.prepare(`INSERT INTO sessions(project_id, session_id, scope) VALUES (?, ?, ?)
    ON CONFLICT(project_id, session_id) DO UPDATE SET scope = excluded.scope`).run(projectId, sessionId, scope);
}

/** Selected IDs only. Scope is never added to the default retrieval payload. */
export function matchingScopeIds(db: Database, projectId: string, ids: string[], scope: string | null): Set<string> {
  if (!ids.length) return new Set();
  const rows = db.prepare(`SELECT id FROM memories WHERE project_id = ? AND scope IS ?
    AND id IN (SELECT value FROM json_each(?))`).all(projectId, scope, JSON.stringify(ids)) as { id: string }[];
  return new Set(rows.map(row => row.id));
}
