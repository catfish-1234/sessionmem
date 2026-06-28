import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { CursorAdapter } from "../../../src/adapters/ide/cursor.js";
import { WindsurfAdapter } from "../../../src/adapters/ide/windsurf.js";
import { ClineAdapter } from "../../../src/adapters/ide/cline.js";
import { CodexAdapter } from "../../../src/adapters/global/codex.js";
import { GenericMCPAdapter } from "../../../src/adapters/generic.js";

/**
 * QLTY-01 gap closure (RESEARCH Gap Analysis):
 *  - Per-adapter install()/uninstall() parity for >=1 IDE adapter (Cursor) and
 *    >=1 global adapter (Codex). Risk #1 ("adapter parity drift").
 *  - Generic-host path (PLAT-08): GenericMCPAdapter.call() returns the
 *    documented not-initialized error envelope when no server is running.
 *
 * Isolation (Pitfall 3 / T-08-07): every adapter resolves its config path from
 * the home directory (and APPDATA on Windows for Cursor). We redirect those env
 * vars to a fresh mkdtemp dir per-test so NO write ever touches the runner's
 * real ~/.claude.json, ~/.codex/config.json, or Cursor settings.json. Originals
 * are restored in afterEach.
 */

const HOME_VARS = ["HOME", "USERPROFILE", "APPDATA"] as const;

function readMcpServers(configPath: string): Record<string, unknown> {
  expect(existsSync(configPath)).toBe(true);
  const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
    mcpServers?: Record<string, unknown>;
  };
  return parsed.mcpServers ?? {};
}

describe("adapter install() parity + generic path", () => {
  let tempHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "sessionmem-install-parity-"));
    savedEnv = {};
    for (const v of HOME_VARS) {
      savedEnv[v] = process.env[v];
      // Point every home/appdata lookup at the throwaway temp dir.
      process.env[v] = tempHome;
    }
  });

  afterEach(() => {
    for (const v of HOME_VARS) {
      if (savedEnv[v] === undefined) delete process.env[v];
      else process.env[v] = savedEnv[v];
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("Cursor (IDE adapter) install() writes the sessionmem MCP block, uninstall() removes it", async () => {
    const adapter = new CursorAdapter();

    // Cursor reads MCP servers from ~/.cursor/mcp.json (same on every platform),
    // resolved through the home env we redirected. The installer creates missing
    // parent dirs, but pre-create to mirror the real host owning the tree.
    const configPath = join(tempHome, ".cursor", "mcp.json");
    mkdirSync(dirname(configPath), { recursive: true });

    expect(await adapter.install()).toBe(true);

    const servers = readMcpServers(configPath);
    expect(servers).toHaveProperty("sessionmem");
    expect(servers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });

    expect(await adapter.uninstall()).toBe(true);
    expect(readMcpServers(configPath)).not.toHaveProperty("sessionmem");
  });

  it("Windsurf (IDE adapter) install() writes to ~/.codeium/windsurf/mcp_config.json, uninstall() removes it", async () => {
    const adapter = new WindsurfAdapter();

    const configPath = join(
      tempHome,
      ".codeium",
      "windsurf",
      "mcp_config.json",
    );
    mkdirSync(dirname(configPath), { recursive: true });

    expect(await adapter.install()).toBe(true);

    const servers = readMcpServers(configPath);
    expect(servers).toHaveProperty("sessionmem");
    expect(servers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });

    expect(await adapter.uninstall()).toBe(true);
    expect(readMcpServers(configPath)).not.toHaveProperty("sessionmem");
  });

  it("Cline (IDE adapter) install() writes the globalStorage cline_mcp_settings.json block with disabled/autoApprove, uninstall() removes it", async () => {
    const adapter = new ClineAdapter();

    // On win32 the adapter uses process.env.APPDATA, which beforeEach redirects
    // to tempHome; on other platforms it derives from the home dir.
    const base =
      process.platform === "win32"
        ? tempHome
        : process.platform === "darwin"
          ? join(tempHome, "Library", "Application Support")
          : join(tempHome, ".config");
    const configPath = join(
      base,
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    mkdirSync(dirname(configPath), { recursive: true });

    expect(await adapter.install()).toBe(true);

    const servers = readMcpServers(configPath);
    expect(servers).toHaveProperty("sessionmem");
    // Cline's richer server schema carries disabled + autoApprove.
    expect(servers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
      disabled: false,
      autoApprove: [],
    });

    expect(await adapter.uninstall()).toBe(true);
    expect(readMcpServers(configPath)).not.toHaveProperty("sessionmem");
  });

  it("Codex (global adapter) install() writes the sessionmem TOML block, uninstall() removes it", async () => {
    const adapter = new CodexAdapter();

    // Codex uses TOML at ~/.codex/config.toml, not JSON.
    const configPath = join(tempHome, ".codex", "config.toml");

    expect(await adapter.install()).toBe(true);

    expect(existsSync(configPath)).toBe(true);
    const toml = readFileSync(configPath, "utf-8");
    expect(toml).toContain("[mcp_servers.sessionmem]");
    expect(toml).toContain('command = "sessionmem"');
    expect(toml).toContain('args = ["run"]');

    // Idempotent re-install: still exactly one section.
    expect(await adapter.install()).toBe(true);
    const tomlAgain = readFileSync(configPath, "utf-8");
    expect(tomlAgain.match(/\[mcp_servers\.sessionmem\]/g)?.length).toBe(1);

    expect(await adapter.uninstall()).toBe(true);
    expect(readFileSync(configPath, "utf-8")).not.toContain(
      "[mcp_servers.sessionmem]",
    );
  });

  it("GenericMCPAdapter.call() returns the INTERNAL not-initialized envelope when no server runs (PLAT-08)", async () => {
    const adapter = new GenericMCPAdapter();

    const result = await adapter.call("retrieveMemories", {
      projectId: "demo",
      query: "anything",
      limit: 5,
      mode: "auto",
      depth: "default",
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("not initialized");
    }
  });
});
