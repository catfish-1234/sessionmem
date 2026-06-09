import { describe, it, expect, vi, afterEach } from "vitest";
import { statsCommand } from "../../../src/cli/commands/stats.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("statsCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("statsCommand prints memories count, db_size_bytes, and total_content_tokens for the project", async () => {
    const ctx = await createTestCliContext();
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
    const ctx = await createTestCliContext();
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
});
