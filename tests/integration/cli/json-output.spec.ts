import { describe, it, expect, vi, afterEach } from "vitest";
import { listCommand } from "../../../src/cli/commands/list.js";
import { searchCommand } from "../../../src/cli/commands/search.js";
import { showCommand } from "../../../src/cli/commands/show.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("--json on search, list and show", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  const printed = (spy: ReturnType<typeof vi.spyOn>) => JSON.parse(spy.mock.calls.map((c) => c.join(" ")).join("\n"));

  it("list --json prints every memory and the project total", async () => {
    ctx = await createTestCliContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await listCommand(ctx, { json: true });
    const out = printed(log);
    expect(out.total).toBe(out.memories.length);
    expect(out.memories.map((m: { id: string }) => m.id)).toContain("test-mem-001");
  });

  it("search --json prints the query and its matches, without the injection block", async () => {
    ctx = await createTestCliContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await searchCommand("TypeScript strict mode", { json: true }, ctx);
    const out = printed(log);
    expect(out.query).toBe("TypeScript strict mode");
    expect(out.memories[0]).toMatchObject({ id: "test-mem-001", kind: "fact" });
    expect(log.mock.calls).toHaveLength(1);
  });

  it("show --json prints the memory", async () => {
    ctx = await createTestCliContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await showCommand("test-mem-001", ctx, { json: true });
    expect(printed(log).memory).toMatchObject({ id: "test-mem-001", content: expect.stringContaining("TypeScript") });
  });

  it("keeps the table output by default", async () => {
    ctx = await createTestCliContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await listCommand(ctx);
    expect(() => JSON.parse(String(log.mock.calls[0]![0]))).toThrow();
  });
});
