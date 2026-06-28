import { describe, it, expect } from "vitest";
import {
  IDEInstaller,
  SESSIONMEM_HOOK_COMMAND,
} from "../../../src/adapters/ide/installer.js";

interface HookShape {
  hooks?: {
    SessionStart?: Array<{
      matcher?: string;
      hooks?: Array<{ type?: string; command?: string }>;
    }>;
    [event: string]: unknown;
  };
  [key: string]: unknown;
}

function parse(content: string): HookShape {
  return JSON.parse(content) as HookShape;
}

describe("IDEInstaller.injectClaudeHookBlock", () => {
  it("adds a SessionStart command hook to an empty config", () => {
    const result = IDEInstaller.injectClaudeHookBlock("{}", SESSIONMEM_HOOK_COMMAND);
    const parsed = parse(result);
    const entries = parsed.hooks?.SessionStart ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks?.[0]).toEqual({
      type: "command",
      command: SESSIONMEM_HOOK_COMMAND,
    });
  });

  it("preserves mcpServers and unrelated settings", () => {
    const existing = JSON.stringify({
      mcpServers: { sessionmem: { command: "sessionmem", args: ["run"] } },
      theme: "dark",
    });
    const parsed = parse(
      IDEInstaller.injectClaudeHookBlock(existing, SESSIONMEM_HOOK_COMMAND),
    );
    expect(parsed.mcpServers).toEqual({
      sessionmem: { command: "sessionmem", args: ["run"] },
    });
    expect(parsed.theme).toBe("dark");
    expect(parsed.hooks?.SessionStart).toHaveLength(1);
  });

  it("preserves a user's existing SessionStart hooks and other hook events", () => {
    const existing = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "my-own-hook" }] },
        ],
        PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }],
      },
    });
    const parsed = parse(
      IDEInstaller.injectClaudeHookBlock(existing, SESSIONMEM_HOOK_COMMAND),
    );
    const commands = (parsed.hooks?.SessionStart ?? []).flatMap((e) =>
      (e.hooks ?? []).map((h) => h.command),
    );
    expect(commands).toContain("my-own-hook");
    expect(commands).toContain(SESSIONMEM_HOOK_COMMAND);
    expect(parsed.hooks?.PreToolUse).toBeDefined();
  });

  it("is idempotent — re-injecting does not duplicate the entry", () => {
    const once = IDEInstaller.injectClaudeHookBlock("{}", SESSIONMEM_HOOK_COMMAND);
    const twice = IDEInstaller.injectClaudeHookBlock(once, SESSIONMEM_HOOK_COMMAND);
    const parsed = parse(twice);
    expect(parsed.hooks?.SessionStart).toHaveLength(1);
  });

  it("handles JSONC input with comments", () => {
    const jsonc = `{\n  // user settings\n  "theme": "dark"\n}`;
    const parsed = parse(
      IDEInstaller.injectClaudeHookBlock(jsonc, SESSIONMEM_HOOK_COMMAND),
    );
    expect(parsed.theme).toBe("dark");
    expect(parsed.hooks?.SessionStart).toHaveLength(1);
  });
});

describe("IDEInstaller.removeClaudeHookBlock", () => {
  it("removes only the sessionmem hook, preserving user hooks", () => {
    const existing = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "my-own-hook" }] },
          { hooks: [{ type: "command", command: SESSIONMEM_HOOK_COMMAND }] },
        ],
      },
    });
    const parsed = parse(
      IDEInstaller.removeClaudeHookBlock(existing, SESSIONMEM_HOOK_COMMAND),
    );
    const commands = (parsed.hooks?.SessionStart ?? []).flatMap((e) =>
      (e.hooks ?? []).map((h) => h.command),
    );
    expect(commands).toEqual(["my-own-hook"]);
  });

  it("drops the SessionStart array and hooks object when only ours existed", () => {
    const injected = IDEInstaller.injectClaudeHookBlock(
      "{}",
      SESSIONMEM_HOOK_COMMAND,
    );
    const parsed = parse(
      IDEInstaller.removeClaudeHookBlock(injected, SESSIONMEM_HOOK_COMMAND),
    );
    expect(parsed.hooks).toBeUndefined();
  });

  it("preserves other hook events when removing SessionStart", () => {
    const existing = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: SESSIONMEM_HOOK_COMMAND }] },
        ],
        PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }],
      },
    });
    const parsed = parse(
      IDEInstaller.removeClaudeHookBlock(existing, SESSIONMEM_HOOK_COMMAND),
    );
    expect(parsed.hooks?.SessionStart).toBeUndefined();
    expect(parsed.hooks?.PreToolUse).toBeDefined();
  });

  it("is a no-op on an empty config", () => {
    const parsed = parse(
      IDEInstaller.removeClaudeHookBlock("{}", SESSIONMEM_HOOK_COMMAND),
    );
    expect(parsed).toEqual({});
  });

  it("round-trips inject then remove back to the original settings", () => {
    const original = JSON.stringify({ theme: "dark" });
    const injected = IDEInstaller.injectClaudeHookBlock(
      original,
      SESSIONMEM_HOOK_COMMAND,
    );
    const removed = parse(
      IDEInstaller.removeClaudeHookBlock(injected, SESSIONMEM_HOOK_COMMAND),
    );
    expect(removed).toEqual({ theme: "dark" });
  });
});
