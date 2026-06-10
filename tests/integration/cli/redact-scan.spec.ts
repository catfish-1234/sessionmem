import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import type { CliContext } from "../../../src/cli/context.js";
import { redactScanCommand } from "../../../src/cli/commands/redactScan.js";

interface TestCtx extends CliContext {
  cleanup: () => void;
}

/**
 * Builds a CliContext over a temp DB. Memories are inserted directly (bypassing
 * storeMemory's redaction) so the stored rows carry RAW secrets — exactly the
 * pre-existing data redact-scan is meant to scrub (D-07).
 */
function makeCtx(raw?: string): TestCtx {
  const dbPath = join(tmpdir(), `sessionmem-redactscan-test-${randomUUID()}.db`);
  const projectId = "test-project";
  const db = openDb({ dbPath });
  const service = createMemoryCoreService({ db });

  if (raw !== undefined) {
    insertMemory(db, {
      id: "secret-mem-001",
      project_id: projectId,
      session_id: "session-1",
      source_adapter: "codex",
      kind: "fact",
      content: raw,
      normalized_content: raw.toLowerCase(),
      importance: 5,
    });
  }

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

const RAW_SECRET = "deploy key is sk-abcdefghijkl do not share";

describe("redactScanCommand", () => {
  let ctx: TestCtx | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup();
    ctx = undefined;
  });

  it("scan (no --apply) reports the match count and leaves rows intact", async () => {
    ctx = makeCtx(RAW_SECRET);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await redactScanCommand({}, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((m) => /Found 1 memories with potential secrets/.test(m)),
    ).toBe(true);

    // Non-destructive: the raw key still persists after a scan.
    const getResult = await ctx.service.getMemory({
      projectId: ctx.projectId,
      memoryId: "secret-mem-001",
    });
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.memory.content).toContain("sk-abcdefghijkl");
    }
  });

  it("scan previews never echo the full raw secret string", async () => {
    ctx = makeCtx(RAW_SECRET);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await redactScanCommand({}, ctx);

    const allOutput = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allOutput).not.toContain("sk-abcdefghijkl");
    expect(allOutput).toContain("[REDACTED_API_KEY]");
  });

  it("--apply redacts matching rows in place and prints a summary count", async () => {
    ctx = makeCtx(RAW_SECRET);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await redactScanCommand({ apply: true }, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.includes("Redacted 1"))).toBe(true);

    const getResult = await ctx.service.getMemory({
      projectId: ctx.projectId,
      memoryId: "secret-mem-001",
    });
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.memory.content).toContain("[REDACTED_API_KEY]");
      expect(getResult.memory.content).not.toContain("sk-abcdefghijkl");
    }
  });

  it("scan with no secret-bearing memories prints Found 0", async () => {
    ctx = makeCtx("a perfectly clean memory with no secrets");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await redactScanCommand({}, ctx);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((m) => /Found 0 memories with potential secrets/.test(m)),
    ).toBe(true);
  });

  it("scan (no --apply) never calls redactExisting with apply:true", async () => {
    ctx = makeCtx(RAW_SECRET);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const originalCall = ctx.service.call.bind(ctx.service);
    const applyValues: unknown[] = [];
    ctx.service.call = async (
      method: Parameters<typeof ctx.service.call>[0],
      req: Parameters<typeof ctx.service.call>[1],
    ) => {
      if (method === "redactExisting") {
        applyValues.push((req as { apply?: boolean }).apply);
      }
      return originalCall(method, req as never);
    };

    await redactScanCommand({}, ctx);

    expect(applyValues).not.toContain(true);
  });

  it("on service failure prints the error and exits 1", async () => {
    ctx = makeCtx(RAW_SECRET);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number) => {
        throw new Error("process.exit called");
      });

    ctx.service.call = (async () => ({
      ok: false,
      error: { code: "INTERNAL", message: "redact blew up" },
    })) as typeof ctx.service.call;

    await expect(redactScanCommand({}, ctx)).rejects.toThrow(
      "process.exit called",
    );

    const errs = errSpy.mock.calls.map((c) => c.join(" "));
    expect(errs.some((m) => m.includes("redact blew up"))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
