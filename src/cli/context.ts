import { homedir } from "os";
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
  dbPath: string;
}

export interface CliContextOverrides {
  dbPath?: string;
  migrationsDir?: string;
  projectId?: string;
  db?: Database;
  service?: ReturnType<typeof createMemoryCoreService>;
}

function deriveProjectId(): string {
  const cwd = process.cwd();
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "default";
}

export function createCliContext(overrides: CliContextOverrides = {}): CliContext {
  const dir = join(homedir(), ".sessionmem");
  mkdirSync(dir, { recursive: true });

  const dbPath = overrides.dbPath ?? join(dir, "memories.db");
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = overrides.migrationsDir ?? join(here, "..", "core", "schema", "migrations");

  const db = overrides.db ?? openDb({ dbPath, migrationsDir });
  const service = overrides.service ?? createMemoryCoreService({ db });
  const projectId = overrides.projectId ?? deriveProjectId();

  return { db, service, projectId, dbPath };
}
