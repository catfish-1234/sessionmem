import { describe, it, expect, vi, afterEach } from "vitest";
import { rememberCommand, parseExpiry, DEFAULT_REMEMBER_IMPORTANCE } from "../../../src/cli/commands/remember.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

describe("rememberCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
  });

  const stored = async (content: string) => {
    const list = await ctx!.service.listMemories({ projectId: ctx!.projectId });
    expect(list.ok).toBe(true);
    return list.ok ? list.memories.find((m) => m.content === content) : undefined;
  };

  it("stores the words as one memory with the requested kind, importance and tags", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await rememberCommand(["Deploy", "with", "pnpm,", "never", "npm"], {
      kind: "decision", importance: "9", tag: ["build", "deploy"],
    }, ctx);

    const memory = await stored("Deploy with pnpm, never npm");
    expect(memory).toBeDefined();
    expect(memory!.kind).toBe("decision");
    expect(memory!.importance).toBe(9);
    expect(memory!.sourceAdapter).toBe("cli");
    expect(memory!.tags).toEqual(["build", "deploy"]);
    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain(`Remembered ${memory!.id} (decision, importance 9).`);
    expect(output).toContain(`sessionmem forget ${memory!.id} --force`);
  });

  it("defaults to a fact at importance 7", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await rememberCommand(["The API runs on port 8080"], {}, ctx);
    const memory = await stored("The API runs on port 8080");
    expect(memory!.kind).toBe("fact");
    expect(memory!.importance).toBe(DEFAULT_REMEMBER_IMPORTANCE);
    expect(DEFAULT_REMEMBER_IMPORTANCE).toBe(7);
  });

  it("redacts secrets before saving and says so", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const key = `sk-ant-api03-${"A".repeat(90)}`;

    await rememberCommand([`staging key is ${key}`], {}, ctx);

    const list = await ctx.service.listMemories({ projectId: ctx.projectId });
    const contents = list.ok ? list.memories.map((m) => m.content) : [];
    expect(contents.some((c) => c.includes(key))).toBe(false);
    expect(contents).toContain("staging key is [REDACTED_ANTHROPIC_KEY]");
    expect(logSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Secrets were redacted before saving");
  });

  it("records an expiry from a duration", async () => {
    ctx = await createTestCliContext();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const before = Date.now();
    await rememberCommand(["temporary freeze on main"], { expires: "2d", kind: "warning" }, ctx);
    const memory = await stored("temporary freeze on main");
    const expiresAt = Date.parse(memory!.expiresAt!);
    expect(expiresAt - before).toBeGreaterThanOrEqual(2 * 86_400_000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(2 * 86_400_000 + 60_000);
  });

  it.each([
    [["x"], { kind: "architecture-ish" }, "--kind must be one of"],
    [["x"], { importance: "11" }, "--importance must be a whole number from 1 to 10"],
    [["x"], { importance: "2.5" }, "--importance must be a whole number from 1 to 10"],
    [["x"], { expires: "yesterday" }, "--expires must be a duration"],
    [["x"], { expires: "2001-01-01" }, "--expires must be in the future"],
    [["   "], {}, "Nothing to remember"],
    [["y".repeat(10001)], {}, "at most 10000 characters"],
  ])("rejects %j %j without storing anything", async (words, options, message) => {
    ctx = await createTestCliContext();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    const before = await ctx.service.listMemories({ projectId: ctx.projectId });

    await expect(rememberCommand(words, options, ctx)).rejects.toThrow("process.exit called");

    expect(errSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(message);
    const after = await ctx.service.listMemories({ projectId: ctx.projectId });
    expect(after.ok && before.ok && after.memories.length).toBe(before.ok ? before.memories.length : -1);
  });

  it("prints the stored memory as JSON with --json", async () => {
    ctx = await createTestCliContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await rememberCommand(["prefers tabs"], { kind: "preference", json: true }, ctx);
    const printed = JSON.parse(String(logSpy.mock.calls.at(-1)![0]));
    expect(printed.memory).toMatchObject({ kind: "preference", content: "prefers tabs", sourceAdapter: "cli" });
    expect(printed.warningCodes).toEqual([]);
  });
});

describe("parseExpiry", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("accepts durations, dates and UTC timestamps", () => {
    expect(parseExpiry("12h", now)).toBe("2026-11-20T00:00:00Z");
    expect(parseExpiry("30d", now)).toBe("2026-12-19T12:00:00Z");
    expect(parseExpiry("2w", now)).toBe("2026-12-03T12:00:00Z");
    expect(parseExpiry("2026-12-31", now)).toBe("2026-12-31T00:00:00Z");
    expect(parseExpiry("2027-01-01T09:30:00Z", now)).toBe("2027-01-01T09:30:00Z");
  });

  it("rejects past times, impossible dates and other shapes", () => {
    expect(() => parseExpiry("2026-11-19", now)).toThrow("in the future");
    // An impossible day is rejected rather than rolled over into the next month.
    expect(() => parseExpiry("2027-02-31", now)).toThrow("not a real date");
    expect(() => parseExpiry("2027-02-29T10:00:00Z", now)).toThrow("not a real date");
    expect(() => parseExpiry("2026-13-45", now)).toThrow("not a real date");
    expect(() => parseExpiry("30 days", now)).toThrow("must be a duration");
    expect(() => parseExpiry("2027-01-01T09:30:00+02:00", now)).toThrow("must be a duration");
  });
});
