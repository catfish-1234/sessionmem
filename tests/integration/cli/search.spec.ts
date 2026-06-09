import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCommand } from "../../../src/cli/commands/search.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("searchCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searchCommand prints a table of matching memories ranked by relevance", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("TypeScript", {}, ctx);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain(" | ");
    // ANSI-free check
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("searchCommand respects --limit flag to constrain result count", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("memory", { limit: 1 }, ctx);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    // header + at most 1 result line
    const lines = output.split("\n");
    expect(lines.length).toBeLessThanOrEqual(2); // header + 1 result
  });

  it("searchCommand prints empty table when no memories match the query", async () => {
    const ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("xyzzy-nonexistent-query-12345", {}, ctx);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    // Should still have header row with column separators
    expect(output).toContain(" | ");
    // No ANSI
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("searchCommand exits non-zero on service error", async () => {
    const ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Override call() to return failure envelope
    const callSpy = vi.spyOn(ctx.service, "call").mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "service unavailable" },
    });

    await expect(
      searchCommand("test", {}, ctx),
    ).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("service unavailable");
    expect(exitSpy).toHaveBeenCalledWith(1);
    callSpy.mockRestore();
  });
});
