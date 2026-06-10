import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import type { CliContext } from "../../../src/cli/context.js";
import { retentionPruneCommand } from "../../../src/cli/commands/retention.js";

interface TestCtx extends CliContext {
  cleanup: () => void;
}

/**
 * Builds a CliContext over a temp DB containing a single memory whose
 * created_at is `ageDays` in the past, so retention prune (default 90 days)
 * sees exactly one eligible record.
 */
function makeCtx(ageDays: number): TestCtx {
  const dbPath = join(tmpdir(), `sessionmem-retention-test-${randomUUID()}.db`);
  const projectId = "test-project";
  const db = openDb({ dbPath });
  const service = createMemoryCoreService({ db });

  const agedIso = new Date(
    Date.now() - ageDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const content = "Old memory eligible for pruning.";
  insertMemory(db, {
    id: "aged-mem-001",
    project_id: projectId,
    session_id: "session-1",
    source_adapter: "codex",
    kind: "fact",
    content,
    normalized_content: content.toLowerCase(),
    importance: 5,
    created_at: agedIso,
    updated_at: agedIso,
  });

  return {
    db,
    service,
    projectId,
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

describe("retentionPruneCommand", () => {
  let ctx: TestCtx | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup();
    ctx = undefined;
  });

  it("dry-run (no flags) prints the D-12 message and deletes nothing", async () => {
    ctx = makeCtx(200);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await retentionPruneCommand({}, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((m) =>
        /Would delete 1 memories older than 90 days\. Pass --force to confirm\./.test(
          m,
        ),
      ),
    ).toBe(true);

    // Memory must still exist
    const listResult = await ctx.service.listMemories({
      projectId: ctx.projectId,
    });
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.memories.map((m) => m.id)).toContain("aged-mem-001");
    }
  });

  it("--force deletes eligible memories and prints a summary count", async () => {
    ctx = makeCtx(200);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await retentionPruneCommand({ force: true }, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.includes("Deleted 1"))).toBe(true);

    const listResult = await ctx.service.listMemories({
      projectId: ctx.projectId,
    });
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.memories.map((m) => m.id)).not.toContain("aged-mem-001");
    }
  });

  it("dry-run never calls pruneMemories with dryRun:false", async () => {
    ctx = makeCtx(200);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const originalCall = ctx.service.call.bind(ctx.service);
    const dryRunValues: unknown[] = [];
    ctx.service.call = async (
      method: Parameters<typeof ctx.service.call>[0],
      req: Parameters<typeof ctx.service.call>[1],
    ) => {
      if (method === "pruneMemories") {
        dryRunValues.push((req as { dryRun?: boolean }).dryRun);
      }
      return originalCall(method, req as never);
    };

    await retentionPruneCommand({}, ctx);

    expect(dryRunValues).toContain(true);
    expect(dryRunValues).not.toContain(false);
  });

  it("--days override changes the effective retention window in the message", async () => {
    ctx = makeCtx(40);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // 40-day-old memory is NOT eligible at default 90 days, but IS at 30 days.
    await retentionPruneCommand({ days: "30" }, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((m) =>
        /Would delete 1 memories older than 30 days\. Pass --force to confirm\./.test(
          m,
        ),
      ),
    ).toBe(true);
  });

  it("on service failure prints the error and exits 1", async () => {
    ctx = makeCtx(200);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    // Force the service call to report failure
    ctx.service.call = (async () => ({
      ok: false,
      error: { code: "INTERNAL", message: "prune blew up" },
    })) as typeof ctx.service.call;

    await expect(
      retentionPruneCommand({ force: true }, ctx),
    ).rejects.toThrow("process.exit called");

    expect(errSpy).toHaveBeenCalled();
    const errs = errSpy.mock.calls.map((c) => c.join(" "));
    expect(errs.some((m) => m.includes("prune blew up"))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
