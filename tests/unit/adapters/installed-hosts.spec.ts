import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { detectInstalledAdapters, executableCandidates, resolveInstallAdapters } from "../../../src/adapters/installedHosts.js";

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), homedir: () => home.path }));

describe("installed host discovery", () => {
  beforeEach(() => {
    home.path = mkdtempSync(join(tmpdir(), "sessionmem-detection-"));
    vi.stubEnv("PATH", home.path);
    vi.stubEnv("SESSIONMEM_ADAPTER", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home.path, { recursive: true, force: true });
  });

  function binary(name: string) {
    const file = join(home.path, name + (process.platform === "win32" ? ".cmd" : ""));
    writeFileSync(file, "This probe must never execute a host binary.\n");
    chmodSync(file, 0o755);
    return file;
  }

  it.each([["codex", "Codex"], ["cursor", "Cursor"], ["windsurf", "Windsurf"]])("finds %s from a terminal without executing it", (executable, name) => {
    binary(executable);
    expect(detectInstalledAdapters().map(adapter => adapter.name)).toEqual([name]);
  });

  it("finds Claude Code from an ordinary terminal without executing it", () => {
    binary("claude");
    expect(detectInstalledAdapters().map((adapter) => adapter.name)).toEqual(["Claude Code"]);
    expect(resolveInstallAdapters().forced).toBe(false);
  });

  it("does not treat runtime environment markers or config directories as installed binaries", () => {
    vi.stubEnv("CLAUDECODE", "1");
    mkdirSync(join(home.path, ".claude"));
    mkdirSync(join(home.path, "claude"));
    expect(detectInstalledAdapters()).toEqual([]);
    expect(() => resolveInstallAdapters()).toThrow("No supported agent host found");
  });

  it("ignores files without execute permission on POSIX", () => {
    if (process.platform === "win32") return;
    const file = binary("claude");
    chmodSync(file, 0o644);
    expect(detectInstalledAdapters()).toEqual([]);
  });

  it("finds the native Claude install outside PATH", () => {
    mkdirSync(join(home.path, ".local", "bin"), { recursive: true });
    binary(".local/bin/claude");
    vi.stubEnv("PATH", "");
    expect(detectInstalledAdapters().map((adapter) => adapter.name)).toEqual(["Claude Code"]);
  });

  it("returns every matching table entry once even across repeated PATH directories", () => {
    binary("claude");
    binary("cursor");
    vi.stubEnv("PATH", `${home.path}${delimiter}${home.path}`);
    const table = [
      { adapter: "claude-code", executables: ["claude"] },
      { adapter: "cursor", executables: ["cursor"] },
      { adapter: "windsurf", executables: ["windsurf"] },
    ] as const;
    expect(detectInstalledAdapters(table).map((adapter) => adapter.name)).toEqual(["Claude Code", "Cursor"]);
  });

  it("honors explicit and environment overrides without any detected host", () => {
    vi.stubEnv("SESSIONMEM_ADAPTER", "cursor");
    expect(resolveInstallAdapters().adapters[0].name).toBe("Cursor");
    expect(resolveInstallAdapters({ adapter: "claude-code" })).toMatchObject({ forced: true, adapters: [{ name: "Claude Code" }] });
    expect(() => resolveInstallAdapters({ adapter: "invalid" })).toThrow("Unknown adapter");
  });

  it("includes Windows executable shims", () => {
    const candidates = executableCandidates("claude");
    expect(candidates).toContain("claude");
    if (process.platform === "win32") expect(candidates).toContain("claude.cmd");
  });
});
