import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { ClaudeCodeAdapter } from "../../../src/adapters/global/claudeCode.js";
import {
  SESSIONMEM_HOOK_COMMAND,
  SESSIONMEM_SESSION_END_HOOK_COMMAND,
} from "../../../src/adapters/ide/installer.js";

/**
 * Verifies the Claude Code adapter wires the deterministic auto-injection path:
 * install() registers the sessionmem SessionStart hook in ~/.claude/settings.json
 * (alongside the MCP server in ~/.claude.json) and uninstall() removes it,
 * without clobbering pre-existing user settings. HOME/USERPROFILE are redirected
 * to a throwaway dir so nothing touches the runner's real config.
 */
const HOME_VARS = ["HOME", "USERPROFILE"] as const;

interface HookArray {
  hooks?: Array<{ command?: string }>;
}
interface Settings {
  hooks?: {
    SessionStart?: HookArray[];
    SessionEnd?: HookArray[];
  };
  theme?: string;
}

function readSettings(path: string): Settings {
  return JSON.parse(readFileSync(path, "utf-8")) as Settings;
}

function sessionStartCommands(s: Settings): Array<string | undefined> {
  return (s.hooks?.SessionStart ?? []).flatMap((e) =>
    (e.hooks ?? []).map((h) => h.command),
  );
}

function sessionEndCommands(s: Settings): Array<string | undefined> {
  return (s.hooks?.SessionEnd ?? []).flatMap((e) =>
    (e.hooks ?? []).map((h) => h.command),
  );
}

describe("ClaudeCodeAdapter SessionStart hook wiring", () => {
  let tempHome: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "sessionmem-cc-hook-"));
    saved = {};
    for (const v of HOME_VARS) {
      saved[v] = process.env[v];
      process.env[v] = tempHome;
    }
  });

  afterEach(() => {
    for (const v of HOME_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("install() writes the SessionStart hook; uninstall() removes it", async () => {
    const adapter = new ClaudeCodeAdapter();
    const settingsPath = join(tempHome, ".claude", "settings.json");

    expect(await adapter.install()).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    expect(sessionStartCommands(readSettings(settingsPath))).toContain(
      SESSIONMEM_HOOK_COMMAND,
    );

    expect(await adapter.uninstall()).toBe(true);
    expect(sessionStartCommands(readSettings(settingsPath))).not.toContain(
      SESSIONMEM_HOOK_COMMAND,
    );
  });

  it("install() also writes the SessionEnd hook; uninstall() removes it", async () => {
    const adapter = new ClaudeCodeAdapter();
    const settingsPath = join(tempHome, ".claude", "settings.json");

    expect(await adapter.install()).toBe(true);
    expect(sessionEndCommands(readSettings(settingsPath))).toContain(
      SESSIONMEM_SESSION_END_HOOK_COMMAND,
    );

    expect(await adapter.uninstall()).toBe(true);
    const after = readSettings(settingsPath);
    expect(sessionEndCommands(after)).not.toContain(
      SESSIONMEM_SESSION_END_HOOK_COMMAND,
    );
    // Both sessionmem hook events fully removed → hooks object cleaned up.
    expect(after.hooks).toBeUndefined();
  });

  it("preserves pre-existing user settings.json content", async () => {
    const settingsPath = join(tempHome, ".claude", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }), "utf-8");

    const adapter = new ClaudeCodeAdapter();
    await adapter.install();
    expect(readSettings(settingsPath).theme).toBe("dark");

    await adapter.uninstall();
    expect(readSettings(settingsPath).theme).toBe("dark");
  });
});
