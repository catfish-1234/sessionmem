vi.mock("../../../src/cli/autostart/index.js", () => ({
  createAutostart: vi.fn(() => ({ enable: vi.fn(), disable: vi.fn() })),
}));
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { writeFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { AdapterFactory } from "../../../src/adapters/factory.js";
import { uninstallCommand } from "../../../src/cli/commands/uninstall.js";
import {
  injectClaudeMdBlock,
  hasClaudeMdBlock,
} from "../../../src/adapters/claudeMdInjector.js";

// Installation tests must never edit the developer's real guidance or config.
const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  homedir: () => testHome.path,
}));

describe("uninstallCommand", () => {
  beforeEach(() => {
    testHome.path = mkdtempSync(join(tmpdir(), "sessionmem-uninstall-home-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(testHome.path, { recursive: true, force: true });
  });

  it("calls adapter.uninstall() and prints success message on success", async () => {
    const dbPath = join(tmpdir(), `sessionmem-uninstall-test-${randomUUID()}.db`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const mockAdapter = {
      name: "TestAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      uninstall: vi.fn().mockResolvedValue(true),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    await uninstallCommand({ dbPath });

    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("TestAdapter");
    expect(allLogs).toContain("config removed");
    expect(mockAdapter.uninstall).toHaveBeenCalledOnce();
  });

  it("leaves memories.db intact when --purge is not passed (default)", async () => {
    // Create a dummy DB file
    const dbPath = join(tmpdir(), `sessionmem-uninstall-db-${randomUUID()}.db`);
    writeFileSync(dbPath, "dummy db content");

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const mockAdapter = {
      name: "TestAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      uninstall: vi.fn().mockResolvedValue(true),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    // No --purge
    await uninstallCommand({ dbPath });

    // DB file should still exist
    expect(existsSync(dbPath)).toBe(true);
  });

  it("deletes memories.db only when --purge is passed", async () => {
    // Create a dummy DB file
    const dbPath = join(tmpdir(), `sessionmem-purge-test-${randomUUID()}.db`);
    writeFileSync(dbPath, "dummy db content");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const mockAdapter = {
      name: "TestAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      uninstall: vi.fn().mockResolvedValue(true),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    await uninstallCommand({ purge: true, dbPath });

    // DB file should be deleted
    expect(existsSync(dbPath)).toBe(false);

    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("memories.db deleted");
  });


  it("purges the environment-selected database and preserves the default", async () => {
    const { mkdirSync } = await import("fs");
    const defaultDir = join(testHome.path, ".sessionmem");
    mkdirSync(defaultDir);
    const defaultDb = join(defaultDir, "memories.db");
    const selectedDb = join(testHome.path, "selected.db");
    writeFileSync(defaultDb, "default");
    writeFileSync(selectedDb, "selected");
    vi.stubEnv("SESSIONMEM_DB_PATH", selectedDb);
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue({
      name: "TestAdapter", uninstall: async () => true, guidanceTargets: () => [],
    } as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await uninstallCommand({ purge: true });
    expect(existsSync(selectedDb)).toBe(false);
    expect(existsSync(defaultDb)).toBe(true);
  });

  it("prints error and exits non-zero when adapter has no uninstall() capability", async () => {
    const dbPath = join(tmpdir(), `sessionmem-uninstall-test-${randomUUID()}.db`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let exitCode: number | undefined;
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${exitCode})`);
    });

    const mockAdapter = {
      name: "NoUninstallAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      // no uninstall method
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    await expect(uninstallCommand({ dbPath })).rejects.toThrow(/process\.exit/);

    expect(exitCode).toBe(1);
    const allErrors = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("NoUninstallAdapter");
  });

  it("removes CLAUDE.md block during uninstall", async () => {
    const dbPath = join(tmpdir(), `sessionmem-uninstall-test-${randomUUID()}.db`);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const mockAdapter = {
      name: "TestAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      uninstall: vi.fn().mockResolvedValue(true),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");

    // Pre-inject the block so we can verify removal
    injectClaudeMdBlock(claudeMdPath);
    expect(hasClaudeMdBlock(claudeMdPath)).toBe(true);

    await uninstallCommand({ dbPath });

    expect(hasClaudeMdBlock(claudeMdPath)).toBe(false);
  });
});
