import { describe, it, expect, vi, afterEach } from "vitest";
import { editCommand } from "../../../src/cli/commands/edit.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("editCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  const store = async (content: string) => {
    const result = await ctx!.service.storeMemory({
      projectId: ctx!.projectId, memoryId: "m-edit", sessionId: "s", sourceAdapter: "cli",
      kind: "fact", content, importance: 5, tags: ["old"],
    });
    return result.memory;
  };

  it("rewrites the text in place and prints what it replaced", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await store("Builds use npm");

    await editCommand("m-edit", ["Builds", "use", "pnpm"], { importance: "8", tag: ["build"] }, ctx);

    const after = await ctx.service.getMemory({ projectId: ctx.projectId, memoryId: "m-edit" });
    expect(after.memory.content).toBe("Builds use pnpm");
    expect(after.memory.importance).toBe(8);
    expect(after.memory.tags).toEqual(["build"]);
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Updated m-edit (fact, importance 8).");
    expect(output).toContain("Builds use npm");
  });

  it("clears tags and expiry without touching the text", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await store("Temporary proxy on 8888");

    await editCommand("m-edit", [], { clearTags: true, expires: "never", kind: "warning" }, ctx);

    const after = await ctx.service.getMemory({ projectId: ctx.projectId, memoryId: "m-edit" });
    expect(after.memory.content).toBe("Temporary proxy on 8888");
    expect(after.memory.kind).toBe("warning");
    expect(after.memory.tags ?? null).toBeNull();
  });

  it("exits without a change to make, or for an unknown id", async () => {
    ctx = await createTestCliContext();
    const exit = vi.spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await store("Something");

    await expect(editCommand("m-edit", [], {}, ctx)).rejects.toThrow("exit 1");
    expect(errors.mock.calls.flat().join("\n")).toContain("Nothing to change");
    await expect(editCommand("nope", [], { importance: "3" }, ctx)).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
