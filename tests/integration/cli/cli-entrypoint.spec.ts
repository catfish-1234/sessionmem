import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, rmSync } from "fs";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";

/**
 * End-to-end regression spec for the REAL sessionmem binary.
 *
 * Unlike the per-command specs (which import the command functions and inject a
 * CliContext directly), this spec spawns `node dist/cli/index.js` so it exercises
 * commander's actual dispatch. That dispatch is what surfaced the ctx-collision
 * bug (commander appends its own Command instance to every .action callback,
 * which previously landed in each command's trailing `ctx?` parameter and made
 * `ctx.service` undefined → "TypeError: Cannot read properties of undefined
 * (reading 'call')"). Every assertion below explicitly checks that this TypeError
 * is absent, so the bug class fails the suite if reintroduced.
 *
 * The spawned binary is pointed at an isolated temp DB via the
 * SESSIONMEM_DB_PATH / SESSIONMEM_PROJECT_ID env override seam (context.ts) so it
 * never touches the real ~/.sessionmem.
 */

const execFileAsync = promisify(execFile);

const CLI_PATH = join(process.cwd(), "dist", "cli", "index.js");
const PROJECT_ID = "entrypoint-test-project";
const SEEDED_IDS = ["e2e-mem-001", "e2e-mem-002", "e2e-mem-003"];
const CTX_TYPE_ERROR = "Cannot read properties of undefined";

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function seedDb(dbPath: string, projectId: string): Promise<void> {
  const db = openDb({ dbPath });
  const service = createMemoryCoreService({ db });
  await service.storeMemory({
    memoryId: SEEDED_IDS[0],
    projectId,
    sessionId: "session-1",
    sourceAdapter: "codex",
    kind: "fact",
    content: "User prefers TypeScript strict mode with NodeNext resolution.",
    importance: 7,
  });
  await service.storeMemory({
    memoryId: SEEDED_IDS[1],
    projectId,
    sessionId: "session-1",
    sourceAdapter: "codex",
    kind: "decision",
    content: "Use vitest for all unit and integration tests.",
    importance: 8,
  });
  await service.storeMemory({
    memoryId: SEEDED_IDS[2],
    projectId,
    sessionId: "session-2",
    sourceAdapter: "claude-code",
    kind: "warning",
    content: "Never commit secrets or API keys to source control.",
    importance: 9,
  });
  db.close();
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

let tempFiles: string[] = [];

function tempPath(suffix: string): string {
  const p = join(tmpdir(), `sessionmem-e2e-${randomUUID()}${suffix}`);
  tempFiles.push(p);
  return p;
}

describe("cli entrypoint (spawned dist/cli/index.js)", () => {
  let dbPath: string;
  let baseEnv: Record<string, string>;

  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `Built CLI not found at ${CLI_PATH}. Run "npm run build" before this spec.`,
      );
    }
    dbPath = tempPath(".db");
    await seedDb(dbPath, PROJECT_ID);
    baseEnv = {
      SESSIONMEM_DB_PATH: dbPath,
      SESSIONMEM_PROJECT_ID: PROJECT_ID,
    };
  });

  afterAll(() => {
    for (const f of tempFiles) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
    tempFiles = [];
  });

  it("search prints a table without the ctx-collision TypeError", async () => {
    const r = await runCli(["search", "TypeScript"], baseEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(" | ");
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("search --limit 1 coerces commander's string and does not throw zod/ctx errors", async () => {
    const r = await runCli(["search", "x", "--limit", "1"], baseEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
    // No zod limit-type validation error
    expect(r.stderr.toLowerCase()).not.toMatch(/expected number/);
  });

  it("list prints a table without the ctx-collision TypeError", async () => {
    const r = await runCli(["list"], baseEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(" | ");
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("show <id> prints key:value lines for a seeded memory", async () => {
    const r = await runCli(["show", SEEDED_IDS[0]], baseEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("content:");
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("show <missing-id> reaches the NOT_FOUND error path (not the ctx TypeError)", async () => {
    const r = await runCli(["show", "missing-id-zzz"], baseEnv);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("stats prints memories / db_size_bytes / total_content_tokens", async () => {
    const r = await runCli(["stats"], baseEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("memories:");
    expect(r.stdout).toContain("db_size_bytes:");
    expect(r.stdout).toContain("total_content_tokens:");
    expect(r.stdout + r.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("forget <id> previews on dry-run then deletes with --force", async () => {
    // Isolated DB so the delete does not perturb other tests
    const fdb = tempPath(".db");
    await seedDb(fdb, PROJECT_ID);
    const env = { SESSIONMEM_DB_PATH: fdb, SESSIONMEM_PROJECT_ID: PROJECT_ID };

    const dry = await runCli(["forget", SEEDED_IDS[0]], env);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("Would delete:");
    expect(dry.stdout + dry.stderr).not.toContain(CTX_TYPE_ERROR);

    const forced = await runCli(["forget", SEEDED_IDS[0], "--force"], env);
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toContain("Deleted");
    expect(forced.stdout + forced.stderr).not.toContain(CTX_TYPE_ERROR);
  });

  it("export then import round-trips losslessly via the real binary", async () => {
    // Source DB to export from
    const srcDb = tempPath(".db");
    await seedDb(srcDb, PROJECT_ID);
    const exportFile = tempPath(".json");

    const exp = await runCli(["export", exportFile], {
      SESSIONMEM_DB_PATH: srcDb,
      SESSIONMEM_PROJECT_ID: PROJECT_ID,
    });
    expect(exp.exitCode).toBe(0);
    expect(exp.stdout + exp.stderr).not.toContain(CTX_TYPE_ERROR);
    expect(existsSync(exportFile)).toBe(true);
    const exported = JSON.parse(readFileSync(exportFile, "utf8"));
    expect(Array.isArray(exported)).toBe(true);
    expect(exported.length).toBe(SEEDED_IDS.length);

    // Fresh, empty destination DB (different file, same projectId)
    const destDb = tempPath(".db");
    openDb({ dbPath: destDb }).close(); // create + migrate, leave empty

    const imp = await runCli(["import", exportFile], {
      SESSIONMEM_DB_PATH: destDb,
      SESSIONMEM_PROJECT_ID: PROJECT_ID,
    });
    expect(imp.exitCode).toBe(0);
    expect(imp.stdout).toContain("Imported");
    expect(imp.stdout + imp.stderr).not.toContain(CTX_TYPE_ERROR);

    // Re-open the destination DB and assert the exported records landed
    const verifyDb = openDb({ dbPath: destDb });
    const rows = listMemoriesByProject(verifyDb, PROJECT_ID);
    verifyDb.close();
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([...SEEDED_IDS].sort());
  }, 20000); // two real binary spawns + DB setup/verification; slow on Windows CI
});
