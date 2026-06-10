import { describe, it, expect, vi, afterEach } from "vitest";
import { listCommand } from "../../../src/cli/commands/list.js";
import { showCommand } from "../../../src/cli/commands/show.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("listCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("listCommand prints a table with ID, importance, date, and preview columns for all project memories", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listCommand(ctx);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain(" | ");
    expect(output).not.toMatch(/\x1b\[/);
    // All seeded memory IDs should appear
    expect(output).toContain("test-mem-001");
    expect(output).toContain("test-mem-002");
    expect(output).toContain("test-mem-003");
  });

  it("listCommand prints empty table when no memories exist for the project", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Use a different projectId with no memories
    const emptyCtx = { ...ctx, projectId: "empty-project" };
    await listCommand(emptyCtx);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    // Header row should still be present
    expect(output).toContain(" | ");
    // No data rows — only 1 line (header)
    expect(output.split("\n").length).toBe(1);
  });
});

describe("showCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  it("showCommand prints key:value block with all MemoryDto fields for a valid memory ID", async () => {
    ctx = await createTestCliContext();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await showCommand("test-mem-001", ctx);

    expect(writeSpy).toHaveBeenCalled();
    const output = (writeSpy.mock.calls[0][0] as string);
    expect(output).toContain("id: test-mem-001");
    expect(output).toContain("content:");
    expect(output).toContain("importance:");
    expect(output).toContain("created_at:");
    expect(output).toContain("session_id:");
    expect(output).toContain("project_id:");
    expect(output).toContain("source_adapter:");
  });

  it("showCommand maps camelCase DTO fields to snake_case labels (source_adapter, created_at, etc.)", async () => {
    ctx = await createTestCliContext();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await showCommand("test-mem-003", ctx);

    expect(writeSpy).toHaveBeenCalled();
    const output = (writeSpy.mock.calls[0][0] as string);
    expect(output).toContain("source_adapter: claude-code");
    expect(output).toContain("session_id: session-2");
  });

  it("showCommand exits non-zero and prints error when memory ID is not found", async () => {
    ctx = await createTestCliContext();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(showCommand("nonexistent-id", ctx)).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalled();
    // Should print the error.message (not the JSON envelope)
    const errorMsg = errorSpy.mock.calls[0][0] as string;
    expect(errorMsg).toContain("nonexistent-id");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
