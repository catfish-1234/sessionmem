import { describe, it, expect, vi, afterEach } from "vitest";
import { forgetCommand } from "../../../src/cli/commands/forget.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("forgetCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("without --force performs dry-run: prints preview and does NOT delete the memory", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await forgetCommand("test-mem-001", {}, ctx);

    // Should print "Would delete:" preview
    const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((msg) => msg.includes("Would delete:"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Pass --force to confirm."))).toBe(true);

    // Memory must still exist
    const listResult = await ctx.service.listMemories({ projectId: ctx.projectId });
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      const ids = listResult.memories.map((m) => m.id);
      expect(ids).toContain("test-mem-001");
    }
  });

  it("with --force deletes the memory and prints confirmation", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await forgetCommand("test-mem-001", { force: true }, ctx);

    // Should print "Deleted"
    const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((msg) => msg.includes("Deleted test-mem-001"))).toBe(true);

    // Memory must be gone
    const listResult = await ctx.service.listMemories({ projectId: ctx.projectId });
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      const ids = listResult.memories.map((m) => m.id);
      expect(ids).not.toContain("test-mem-001");
    }
  });

  it("exits non-zero when memory ID is not found", async () => {
    ctx = await createTestCliContext();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });

    await expect(
      forgetCommand("non-existent-id", {}, ctx),
    ).rejects.toThrow("process.exit called");

    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dry-run does not call forgetMemory (service-level assertion)", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Wrap the original call to track which methods are invoked
    const originalCall = ctx.service.call.bind(ctx.service);
    const calledMethods: string[] = [];
    ctx.service.call = async (method: Parameters<typeof ctx.service.call>[0], req: Parameters<typeof ctx.service.call>[1]) => {
      calledMethods.push(method);
      return originalCall(method, req as never);
    };

    await forgetCommand("test-mem-001", {}, ctx);

    expect(calledMethods).not.toContain("forgetMemory");
    expect(calledMethods).toContain("getMemory");
  });
});
