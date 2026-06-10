import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync } from "fs";
import { statsCommand } from "../../../src/cli/commands/stats.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

/** Write a temp policy config file and return its path (cleaned up per-test). */
function writeTempConfig(partial: Record<string, unknown>): {
  path: string;
  cleanup: () => void;
} {
  const path = join(tmpdir(), `sessionmem-stats-config-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(partial), "utf8");
  return {
    path,
    cleanup: () => {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    },
  };
}

describe("statsCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("statsCommand prints memories count, db_size_bytes, and total_content_tokens for the project", async () => {
    ctx = await createTestCliContext();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await statsCommand(ctx);

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("memories:");
    expect(output).toContain("db_size_bytes:");
    expect(output).toContain("total_content_tokens:");

    // The seeded test context has 3 memories with real content
    const memoriesMatch = output.match(/memories: (\d+)/);
    expect(memoriesMatch).not.toBeNull();
    const memoriesCount = parseInt(memoriesMatch![1], 10);
    expect(memoriesCount).toBe(3);

    // token total > 0 since memories have actual content
    const tokenMatch = output.match(/total_content_tokens: (\d+)/);
    expect(tokenMatch).not.toBeNull();
    const tokenCount = parseInt(tokenMatch![1], 10);
    expect(tokenCount).toBeGreaterThan(0);
  });

  it("statsCommand exits non-zero and prints error message on service failure", async () => {
    ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Override call() to return failure
    vi.spyOn(ctx.service, "call").mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "stats service down" },
    });

    await expect(statsCommand(ctx)).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("stats service down");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("appends D-15 retention and redaction summary lines (defaults)", async () => {
    ctx = await createTestCliContext();
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await statsCommand(ctx);

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    // Original three lines preserved.
    expect(output).toContain("memories:");
    expect(output).toContain("db_size_bytes:");
    expect(output).toContain("total_content_tokens:");
    // New retention line with default 90-day window and an eligible count.
    expect(output).toMatch(
      /Retention: \d+ days \(\d+ memories eligible for pruning\)/,
    );
    // Redaction defaults on.
    expect(output).toContain("Redaction: enabled");
  });

  it("shows Redaction: disabled when config sets redactionEnabled=false", async () => {
    ctx = await createTestCliContext();
    const cfg = writeTempConfig({ redactionEnabled: false });
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await statsCommand(ctx, { configPath: cfg.path });
      const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(output).toContain("Redaction: disabled");
    } finally {
      cfg.cleanup();
    }
  });

  it("conveys pruning disabled when retentionDays<=0", async () => {
    ctx = await createTestCliContext();
    const cfg = writeTempConfig({ retentionDays: 0 });
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await statsCommand(ctx, { configPath: cfg.path });
      const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(output).toMatch(/Retention:.*disabled/i);
    } finally {
      cfg.cleanup();
    }
  });
});
