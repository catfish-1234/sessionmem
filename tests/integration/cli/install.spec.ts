import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import * as installedHosts from "../../../src/adapters/installedHosts.js";
import { installCommand } from "../../../src/cli/commands/install.js";
import { readPolicyConfig } from "../../../src/core/config/policyConfig.js";
import {
  hasClaudeMdBlock,
  removeClaudeMdBlock,
} from "../../../src/adapters/claudeMdInjector.js";

function mockSuccessfulAdapter() {
  const mockAdapter = {
    name: "TestAdapter",
    capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
    install: vi.fn().mockResolvedValue(true),
    call: vi.fn(),
    startMcpServer: vi.fn(),
  };
  vi.spyOn(installedHosts, "resolveInstallAdapters").mockReturnValue({ adapters: [mockAdapter as never], forced: false });
  return mockAdapter;
}

// Installation tests must never edit the developer's real guidance or config.
const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  homedir: () => testHome.path,
}));

describe("installCommand", () => {
  beforeEach(() => {
    testHome.path = mkdtempSync(join(tmpdir(), "sessionmem-install-home-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testHome.path, { recursive: true, force: true });
  });

  it("prints ✓ checklist on successful DB init and adapter.install()", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit called with ${_code}`);
    });

    const mockAdapter = {
      name: "TestAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      install: vi.fn().mockResolvedValue(true),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(installedHosts, "resolveInstallAdapters").mockReturnValue({ adapters: [mockAdapter as never], forced: false });

    await installCommand({}, { dbPath });

    // Success checklist strings
    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("✓ DB initialized");
    expect(allLogs).toContain("config updated");
    expect(allLogs).toContain("✓ sessionmem ready");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mockAdapter.install).toHaveBeenCalledOnce();
  });

  it("calls printManualFallback and exits non-zero when adapter has no install() method", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let exitCode: number | undefined;
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${exitCode})`);
    });

    const mockAdapter = {
      name: "NoInstallAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      // no install method
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(installedHosts, "resolveInstallAdapters").mockReturnValue({ adapters: [mockAdapter as never], forced: false });

    await expect(installCommand({}, { dbPath })).rejects.toThrow(/process\.exit/);

    expect(exitCode).toBe(1);
    // printManualFallback should have printed the MANUAL_CONFIG_BLOCK to stdout
    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("mcpServers");
    // should have printed an error about config failure
    const allErrors = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("config");
  });

  it("calls printManualFallback and exits non-zero when adapter.install() returns false", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let exitCode: number | undefined;
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${exitCode})`);
    });

    const mockAdapter = {
      name: "FailingAdapter",
      capabilities: { supportsPrompts: false, supportsResources: false, supportsTools: true },
      install: vi.fn().mockResolvedValue(false),
      call: vi.fn(),
      startMcpServer: vi.fn(),
    };
    vi.spyOn(installedHosts, "resolveInstallAdapters").mockReturnValue({ adapters: [mockAdapter as never], forced: false });

    await expect(installCommand({}, { dbPath })).rejects.toThrow(/process\.exit/);

    expect(exitCode).toBe(1);
    // printManualFallback prints to log (the JSON block) and error (the message)
    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("mcpServers");
    const allErrors = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("failed");
  });

  it("writes default config.json when absent (retentionDays 90, redactionEnabled true)", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    const configPath = join(tmpdir(), `sessionmem-install-config-${randomUUID()}.json`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSuccessfulAdapter();

    try {
      expect(existsSync(configPath)).toBe(false);

      await installCommand({}, { dbPath, configPath });

      expect(existsSync(configPath)).toBe(true);
      const cfg = readPolicyConfig(configPath);
      expect(cfg.retentionDays).toBe(90);
      expect(cfg.redactionEnabled).toBe(true);

      const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allLogs).toContain("config.json");
    } finally {
      rmSync(configPath, { force: true });
    }
  });

  it("leaves an existing config.json untouched (no clobber of user settings)", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    const configPath = join(tmpdir(), `sessionmem-install-config-${randomUUID()}.json`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSuccessfulAdapter();

    try {
      // Pre-existing user config with a custom retentionDays
      const existing = `${JSON.stringify({ retentionDays: 7, redactionEnabled: false }, null, 2)}\n`;
      writeFileSync(configPath, existing, "utf8");

      await installCommand({}, { dbPath, configPath });

      // Byte-for-byte unchanged
      expect(readFileSync(configPath, "utf8")).toBe(existing);
      const cfg = readPolicyConfig(configPath);
      expect(cfg.retentionDays).toBe(7);

      const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allLogs).toContain("config.json");
    } finally {
      rmSync(configPath, { force: true });
    }
  });

  it("injects CLAUDE.md block during install", async () => {
    const dbPath = join(tmpdir(), `sessionmem-install-test-${randomUUID()}.db`);
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockSuccessfulAdapter();

    const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
    const hadBlockBefore = hasClaudeMdBlock(claudeMdPath);

    try {
      await installCommand({}, { dbPath });

      expect(hasClaudeMdBlock(claudeMdPath)).toBe(true);
    } finally {
      // Clean up: only remove the block if it was not there before the test
      if (!hadBlockBefore) {
        removeClaudeMdBlock(claudeMdPath);
      }
    }
  });

  it("attempts and reports every detected host even when one fails", async () => {
    const failed = mockSuccessfulAdapter();
    failed.name = "First host";
    failed.install.mockRejectedValue(new Error("settings are read-only"));
    const successful = { ...failed, name: "Second host", install: vi.fn().mockResolvedValue(true) };
    vi.mocked(installedHosts.resolveInstallAdapters).mockReturnValue({ adapters: [failed, successful], forced: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });

    await expect(installCommand({}, { dbPath: join(testHome.path, "memories.db") })).rejects.toThrow("exit 1");
    expect(failed.install).toHaveBeenCalledOnce();
    expect(successful.install).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join("\n")).toContain("Second host config updated");
    expect(log.mock.calls.flat().join("\n")).not.toContain("sessionmem ready");
    expect(error.mock.calls.flat().join("\n")).toContain("First host config update failed");
  });
});
