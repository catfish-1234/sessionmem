import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCommand } from "../../../src/cli/commands/search.js";
import {
  createTestCliContext,
  createTeamUserContext,
} from "../../helpers/cliTestContext.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

describe("searchCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  // Combined output across all console.log calls — search.ts now prints the
  // formatTable block AND the startup-injection block in separate calls.
  const printed = (logSpy: ReturnType<typeof vi.spyOn>): string =>
    logSpy.mock.calls.map((c) => c[0] as string).join("\n");

  it("searchCommand prints a table of matching memories ranked by relevance", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("TypeScript", {}, ctx);

    const output = printed(logSpy);
    expect(output).toContain(" | ");
    // ANSI-free check
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("searchCommand respects --limit flag to constrain result count", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("memory", { limit: 1 }, ctx);

    const output = printed(logSpy);
    // The injection block adds lines, so scope the bound to the TABLE portion:
    // count only the rows that carry column separators (header + result rows).
    const tableLines = output.split("\n").filter((line) => line.includes(" | "));
    expect(tableLines.length).toBeLessThanOrEqual(2); // header + 1 result
  });

  it("searchCommand prints empty table when no memories match the query", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("xyzzy-nonexistent-query-12345", {}, ctx);

    const output = printed(logSpy);
    // Should still have header row with column separators
    expect(output).toContain(" | ");
    // No ANSI
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("searchCommand output annotates a teammate-authored memory with the author prefix", async () => {
    // Seed a memory authored by "alice".
    ctx = createTeamUserContext({ username: "alice" });
    await ctx.service.storeMemory({
      memoryId: "team-mem-alice-001",
      projectId: ctx.projectId,
      sessionId: "session-alice",
      sourceAdapter: "claude-code",
      kind: "decision",
      content: "Adopt pnpm for the monorepo.",
      importance: 8,
    });

    // Search the SAME db through a service whose local username is "bob": the
    // D-10 author prefix should appear because alice !== bob.
    const bobService = createMemoryCoreService({ db: ctx.db, username: "bob" });
    const bobCtx = { ...ctx, service: bobService, username: "bob" };

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("pnpm", {}, bobCtx);

    const output = printed(logSpy);
    expect(output).toContain("alice: ");
    expect(output).toContain("pnpm");
  });

  it("searchCommand does NOT prefix a locally-authored memory", async () => {
    // Seed a memory authored by "bob" and search through the SAME bob service.
    ctx = createTeamUserContext({ username: "bob" });
    await ctx.service.storeMemory({
      memoryId: "team-mem-bob-001",
      projectId: ctx.projectId,
      sessionId: "session-bob",
      sourceAdapter: "claude-code",
      kind: "decision",
      content: "Adopt pnpm for the monorepo.",
      importance: 8,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await searchCommand("pnpm", {}, ctx);

    const output = printed(logSpy);
    expect(output).not.toContain("bob: ");
  });

  it("searchCommand exits non-zero on service error", async () => {
    ctx = await createTestCliContext();
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
