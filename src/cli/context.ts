import { homedir, userInfo } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import type { Database } from "better-sqlite3";
import { openDb } from "../core/storage/db.js";
import { createMemoryCoreService } from "../core/api/memoryCoreService.js";
import { deriveProjectId } from "./projectId.js";

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
   * Test seam for the install config-defaults step: target a temp
   * config.json instead of ~/.sessionmem/config.json. Not consumed by
   * createCliContext itself — install.ts reads it directly.
   */
  configPath?: string;
}

/**
 * Resolve the local OS username once per invocation and sanitize it to a
 * filename-safe token so it can be embedded in exports/filenames without path
 * traversal. Any character outside [A-Za-z0-9._-] becomes "_"; an empty result
 * falls back to "user".
 */
export function localUsername(): string {
  // Env override is a test-injection seam (mirrors deriveProjectId): the CLI
  // runs as the invoking user, so SESSIONMEM_USERNAME is operator-controlled at
  // the same trust level.
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

/**
 * Expand a leading `~/` (or bare `~`) to the user's home directory. Shells do
 * this before a value reaches the process, but env vars set programmatically or
 * in config files are passed through verbatim, so we expand here too.
 */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    // `homedir()` is the fixed base; `p` is SESSIONMEM_DB_PATH, a local CLI
    // config the operator sets for their own filesystem — not external user input.
    return join(homedir(), p.slice(2));
  }
  return p;
}

function defaultDbPath(dir: string): string {
  // Env override seam (see deriveProjectId). Defaults to ~/.sessionmem/memories.db.
  const envDbPath = process.env.SESSIONMEM_DB_PATH;
  if (envDbPath && envDbPath.trim() !== "") return expandTilde(envDbPath);
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
