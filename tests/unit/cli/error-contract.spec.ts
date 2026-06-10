import { describe, it, expect, vi, afterEach } from "vitest";
import { showCommand } from "../../../src/cli/commands/show.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("CLI error contract (D-03)", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("top-level error handler prints error.message to stderr and calls process.exit(1)", async () => {
    ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Inject a service that returns a failure envelope
    vi.spyOn(ctx.service, "call").mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Memory not found: test-id" },
    });

    await expect(showCommand("test-id", ctx)).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    // Must print only the message, not the JSON envelope
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toBe("Memory not found: test-id");
  });

  it("command action that throws DomainError surfaces error.message (not JSON envelope) to stderr", async () => {
    ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Use a real NOT_FOUND path — request a memory that does not exist
    await expect(showCommand("does-not-exist-at-all", ctx)).rejects.toThrow(
      "process.exit called",
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    // error.message should be a readable string, not '[object Object]' or JSON
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(typeof logged).toBe("string");
    expect(logged).not.toContain('"code"');
    expect(logged).not.toContain('"message"');
    expect(logged).toContain("does-not-exist-at-all");
  });

  it("command action that throws unknown error surfaces String(err) to stderr", async () => {
    ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Inject a service that returns an error envelope with a custom message
    vi.spyOn(ctx.service, "call").mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "unexpected internal failure" },
    });

    await expect(showCommand("some-id", ctx)).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith("unexpected internal failure");
  });
});
