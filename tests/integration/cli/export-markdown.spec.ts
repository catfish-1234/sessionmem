import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { exportCommand } from "../../../src/cli/commands/export.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  homedir: () => testHome.path,
}));

describe("export --format markdown", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  beforeEach(() => {
    testHome.path = mkdtempSync(join(tmpdir(), "sessionmem-md-home-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
    rmSync(testHome.path, { recursive: true, force: true });
  });

  it("infers markdown from a .md path and writes a grouped document", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const outPath = join(testHome.path, "memory.md");
    await exportCommand(outPath, ctx);
    const text = readFileSync(outPath, "utf8");
    expect(text).toMatch(/^# Project memory: /);
    expect(text).toContain("3 of 3 memories shown");
    expect(text).toMatch(/^## .+ \(\d+\)$/m);
    expect(logSpy.mock.calls.flat().join(" ")).toContain(`Exported 3 memories to ${outPath}`);
  });

  it("writes to stdout for -, and the default path gets a .md extension", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    await exportCommand("-", ctx, { format: "markdown" });
    expect(writes.join("")).toMatch(/^# Project memory: /);

    await exportCommand(undefined, ctx, { format: "md" });
    const expected = join(testHome.path, ".sessionmem", `export-${new Date().toISOString().slice(0, 10)}.md`);
    expect(existsSync(expected)).toBe(true);
  });

  it("refuses markdown-only filters on the complete JSON export, and bad values", async () => {
    ctx = await createTestCliContext();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: string) => { errors.push(message); });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await exportCommand(join(testHome.path, "out.json"), ctx, { minImportance: "5" });
    await exportCommand(join(testHome.path, "out.md"), ctx, { minImportance: "11" });
    await exportCommand(join(testHome.path, "out.txt"), ctx, { format: "yaml" });
    expect(exit).toHaveBeenCalledTimes(3);
    expect(errors[0]).toMatch(/markdown only/);
    expect(errors[1]).toMatch(/1 to 10/);
    expect(errors[2]).toMatch(/Unknown export format/);
    expect(existsSync(join(testHome.path, "out.json"))).toBe(false);
  });
});
