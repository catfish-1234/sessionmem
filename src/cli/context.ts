import { homedir, userInfo } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import type { Database } from "better-sqlite3";
import { openDb } from "../core/storage/db.js";
import { createMemoryCoreService } from "../core/api/memoryCoreService.js";

export interface CliContext {
  db: Database;
  service: ReturnType<typeof createMemoryCoreService>;
  projectId: string;
  username: string;
  dbPath: string;
}

export interface CliContextOverrides {
  dbPath?: string;
  migrationsDir?: string;
  projectId?: string;
  username?: string;
  db?: Database;
  service?: ReturnType<typeof createMemoryCoreService>;
  /**
   * Test seam for the install config-defaults step (D-10): target a temp
   * config.json instead of ~/.sessionmem/config.json. Not consumed by
   * createCliContext itself — install.ts reads it directly.
   */
  configPath?: string;
}

/**
 * Resolve the local OS username once per invocation (D-07) and sanitize it to a
 * filename-safe token so it can be embedded in exports/filenames without path
 * traversal. Any character outside [A-Za-z0-9._-] becomes "_"; an empty result
 * falls back to "user" (D-05).
 */
export function localUsername(): string {
  // Env override is a test-injection seam (mirrors deriveProjectId): the CLI
  // runs as the invoking user, so SESSIONMEM_USERNAME is operator-controlled at
  // the same trust level (T-05-15).
  const envUsername = process.env.SESSIONMEM_USERNAME;
  const raw =
    envUsername && envUsername.trim() !== "" ? envUsername : safeUserInfoName();
  const sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized === "" ? "user" : sanitized;
}

function safeUserInfoName(): string {
  try {
    return userInfo().username ?? "";
  } catch {
    // userInfo() can throw on some platforms when there is no /etc/passwd entry.
    return "";
  }
}

function deriveProjectId(): string {
  // Env override is a test-injection seam (mirrors Plan 01's override pattern):
  // it lets a spawned binary target a deterministic projectId without touching
  // the real ~/.sessionmem. No privilege boundary is crossed — the CLI runs as
  // the invoking user and the env var is operator-controlled (T-05-15).
  const envProjectId = process.env.SESSIONMEM_PROJECT_ID;
  if (envProjectId && envProjectId.trim() !== "") return envProjectId;

  const cwd = process.cwd();
  const parts = cwd.replace(/\\/g, "/").split("/");
  const raw = parts[parts.length - 1] || "default";
  // Sanitize to a filename-safe token (mirrors localUsername) so it can be
  // embedded in shared-path join()s without path traversal.
  const sanitized = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized === "" || sanitized === "." || sanitized === ".."
    ? "default"
    : sanitized;
}

function defaultDbPath(dir: string): string {
  // Env override seam (see deriveProjectId). Defaults to ~/.sessionmem/memories.db.
  const envDbPath = process.env.SESSIONMEM_DB_PATH;
  if (envDbPath && envDbPath.trim() !== "") return envDbPath;
  // `dir` is the fixed ~/.sessionmem dir computed above, not user input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return join(dir, "memories.db");
}

export function createCliContext(overrides: CliContextOverrides = {}): CliContext {
  const dir = join(homedir(), ".sessionmem");
  mkdirSync(dir, { recursive: true });

  const dbPath = overrides.dbPath ?? defaultDbPath(dir);
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = overrides.migrationsDir ?? join(here, "..", "core", "schema", "migrations");

  const username = overrides.username ?? localUsername();
  const db = overrides.db ?? openDb({ dbPath, migrationsDir });
  const service =
    overrides.service ?? createMemoryCoreService({ db, username });
  const projectId = overrides.projectId ?? deriveProjectId();

  return { db, service, projectId, username, dbPath };
}
