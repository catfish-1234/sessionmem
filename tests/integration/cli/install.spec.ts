import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { AdapterFactory } from "../../../src/adapters/factory.js";
import { installCommand } from "../../../src/cli/commands/install.js";

describe("installCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

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
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

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
    vi.spyOn(AdapterFactory, "detectAdapter").mockReturnValue(mockAdapter as never);

    await expect(installCommand({}, { dbPath })).rejects.toThrow(/process\.exit/);

    expect(exitCode).toBe(1);
    // printManualFallback prints to log (the JSON block) and error (the message)
    const allLogs = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allLogs).toContain("mcpServers");
    const allErrors = errSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("failed");
  });
});
