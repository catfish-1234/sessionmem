import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "fs";
import type { Database } from "better-sqlite3";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import type { CliContext } from "../../../src/cli/context.js";
import {
  teamEnableCommand,
  teamDisableCommand,
  teamStatusCommand,
} from "../../../src/cli/commands/team.js";

const LOCAL_USER = "alice";
const PROJECT = "team-test-project";

interface TestCtx extends CliContext {
  cleanup: () => void;
}

function makeContext(): TestCtx {
  const dbPath = join(tmpdir(), `sessionmem-team-${randomUUID()}.db`);
  const db: Database = openDb({ dbPath });
  const service = createMemoryCoreService({ db, username: LOCAL_USER });

  // Two local-authored rows + two teammate-authored rows for this project.
  insertMemory(db, {
    id: "local-1",
    project_id: PROJECT,
    session_id: "s1",
    source_adapter: "codex",
    kind: "fact",
    content: "local fact",
    normalized_content: "local fact",
    importance: 5,
    author: LOCAL_USER,
  });
  insertMemory(db, {
    id: "local-2",
    project_id: PROJECT,
    session_id: "s1",
    source_adapter: "codex",
    kind: "decision",
    content: "local decision",
    normalized_content: "local decision",
    importance: 6,
    author: LOCAL_USER,
  });
  insertMemory(db, {
    id: "mate-1",
    project_id: PROJECT,
    session_id: "s2",
    source_adapter: "codex",
    kind: "fact",
    content: "bob fact",
    normalized_content: "bob fact",
    importance: 5,
    author: "bob",
    origin_project_id: "bob-project",
  });
  insertMemory(db, {
    id: "mate-2",
    project_id: PROJECT,
    session_id: "s2",
    source_adapter: "codex",
    kind: "fact",
    content: "carol fact",
    normalized_content: "carol fact",
    importance: 5,
    author: "carol",
    origin_project_id: "carol-project",
  });
  // Legacy pre-migration-005 row: author backfilled to '' (CR-02). This is
  // a locally-authored memory predating provenance stamping and must
  // survive --remove-team-memories.
  insertMemory(db, {
    id: "legacy-1",
    project_id: PROJECT,
    session_id: "s0",
    source_adapter: "codex",
    kind: "fact",
    content: "legacy local fact",
    normalized_content: "legacy local fact",
    importance: 4,
    author: "",
  });

  return {
    db,
    service,
    projectId: PROJECT,
    username: LOCAL_USER,
    dbPath,
    cleanup: () => {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(dbPath + suffix);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function authorsFor(db: Database): string[] {
  const rows = db
    .prepare("SELECT author FROM memories WHERE project_id = ? ORDER BY id")
    .all(PROJECT) as Array<{ author: string }>;
  return rows.map((r) => r.author);
}

describe("team enable/disable/status commands", () => {
  let configPath: string;
  let ctx: TestCtx | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(configPath, { force: true });
    } catch {
      /* ignore */
    }
    ctx?.cleanup();
    ctx = undefined;
  });

  function freshConfigPath(): string {
    configPath = join(tmpdir(), `sessionmem-team-config-${randomUUID()}.json`);
    return configPath;
  }

  it("teamEnableCommand writes enabled+sharedPath and prints confirmation", () => {
    const path = freshConfigPath();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    teamEnableCommand("/shared", { configPath: path });

    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.team.enabled).toBe(true);
    expect(onDisk.team.sharedPath).toBe("/shared");

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.includes("/shared"))).toBe(true);
  });

  it("teamStatusCommand prints enabled state and the sharedPath read back", () => {
    const path = freshConfigPath();
    // Use a real, writable temp dir as the shared path so the writability probe runs.
    const sharedDir = mkdtempSync(join(tmpdir(), "sessionmem-shared-"));
    teamEnableCommand(sharedDir, { configPath: path });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    teamStatusCommand({ configPath: path });

    const logs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logs).toContain("enabled");
    expect(logs).toContain(sharedDir);
    expect(logs).toContain("exists");

    rmSync(sharedDir, { recursive: true, force: true });
  });

  it("teamDisableCommand (default) sets enabled false and keeps teammate rows", () => {
    const path = freshConfigPath();
    vi.spyOn(console, "log").mockImplementation(() => {});
    teamEnableCommand("/shared", { configPath: path });
    ctx = makeContext();

    teamDisableCommand({ configPath: path }, ctx);

    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.team.enabled).toBe(false);
    // All five rows survive — no data loss default (TEAM-03).
    expect(authorsFor(ctx.db).sort()).toEqual([
      "",
      "alice",
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("teamDisableCommand --remove-team-memories deletes only author != local rows", () => {
    const path = freshConfigPath();
    vi.spyOn(console, "log").mockImplementation(() => {});
    teamEnableCommand("/shared", { configPath: path });
    ctx = makeContext();

    teamDisableCommand({ configPath: path, removeTeamMemories: true }, ctx);

    // Only the two local-authored rows and the legacy empty-author row
    // remain (CR-02): empty author means "local/legacy", not "teammate".
    expect(authorsFor(ctx.db).sort()).toEqual(["", "alice", "alice"]);
  });
});
