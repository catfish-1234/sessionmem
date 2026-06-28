import { describe, it, expect } from "vitest";
import { IDEInstaller } from "../../../src/adapters/ide/installer.js";

describe("IDEInstaller.parseJsonc", () => {
  it("strips single-line comments", () => {
    const jsonc = `{\n  // this is a comment\n  "key": "value"\n}`;
    const parsed = IDEInstaller.parseJsonc(jsonc);
    expect(parsed).toEqual({ key: "value" });
  });

  it("strips trailing commas before closing brace", () => {
    const jsonc = `{ "a": 1, "b": 2, }`;
    const parsed = IDEInstaller.parseJsonc(jsonc);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("strips trailing commas before closing bracket", () => {
    const jsonc = `{ "arr": [1, 2, 3,] }`;
    const parsed = IDEInstaller.parseJsonc(jsonc);
    expect((parsed.arr as number[]).length).toBe(3);
  });

  it("preserves a URL inside a string value (does not treat // as a comment)", () => {
    // FIX-05 regression guard: a naive // comment strip truncates URLs at the
    // `//`. The state machine must keep the full URL intact.
    const jsonc = `{ "url": "https://example.com/path" }`;
    const parsed = IDEInstaller.parseJsonc(jsonc);
    expect(parsed).toEqual({ url: "https://example.com/path" });
  });

  it("preserves a URL while still stripping a real trailing comment", () => {
    const jsonc = `{\n  "url": "https://example.com/a//b" // trailing comment\n}`;
    const parsed = IDEInstaller.parseJsonc(jsonc);
    expect(parsed).toEqual({ url: "https://example.com/a//b" });
  });

  it("strips /* block comments */", () => {
    const result = IDEInstaller.parseJsonc('{ /* comment */ "a": 1 }');
    expect(result).toEqual({ a: 1 });
  });

  it("does not strip trailing comma inside string value", () => {
    const result = IDEInstaller.parseJsonc('{"a":"x,]y","b":1}');
    expect(result).toEqual({ a: "x,]y", b: 1 });
  });

  it("does not strip trailing comma inside string (obj-close variant)", () => {
    const result = IDEInstaller.parseJsonc('{"a":"x,}y"}');
    expect(result).toEqual({ a: "x,}y" });
  });
});

describe("IDEInstaller.injectMcpBlock", () => {
  it("injects MCP server entry into empty config", () => {
    const result = IDEInstaller.injectMcpBlock(
      "{}",
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });
  });

  it("creates mcpServers key when missing", () => {
    const existing = JSON.stringify({ theme: "dark" });
    const result = IDEInstaller.injectMcpBlock(
      existing,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const parsed = JSON.parse(result);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });
  });

  it("preserves other MCP server entries", () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: "other-cmd" } },
    });
    const result = IDEInstaller.injectMcpBlock(
      existing,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.other).toEqual({ command: "other-cmd" });
    expect(parsed.mcpServers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });
  });

  it("overwrites existing sessionmem entry on re-inject", () => {
    const existing = JSON.stringify({
      mcpServers: { sessionmem: { command: "old-cmd", args: [] } },
    });
    const result = IDEInstaller.injectMcpBlock(
      existing,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });
  });

  it("handles JSONC with comments in existing file", () => {
    const jsonc = `{\n  // editor settings\n  "theme": "dark",\n  "mcpServers": {}\n}`;
    const result = IDEInstaller.injectMcpBlock(
      jsonc,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.sessionmem).toEqual({
      command: "sessionmem",
      args: ["run"],
    });
  });
});

describe("IDEInstaller.removeMcpBlock", () => {
  it("removes the named MCP server entry", () => {
    const existing = JSON.stringify({
      mcpServers: {
        sessionmem: { command: "sessionmem", args: ["run"] },
        other: { command: "other" },
      },
    });
    const result = IDEInstaller.removeMcpBlock(existing, "sessionmem");
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.sessionmem).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });

  it("is a no-op when server name not present", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "x" } } });
    const result = IDEInstaller.removeMcpBlock(existing, "sessionmem");
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(Object.keys(parsed.mcpServers)).toHaveLength(1);
  });

  it("is a no-op on empty config", () => {
    const result = IDEInstaller.removeMcpBlock("{}", "sessionmem");
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({});
  });

  it("round-trips inject then remove cleanly", () => {
    const original = JSON.stringify({ theme: "dark" });
    const injected = IDEInstaller.injectMcpBlock(
      original,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
    const removed = IDEInstaller.removeMcpBlock(injected, "sessionmem");
    const parsed = JSON.parse(removed);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers?.sessionmem).toBeUndefined();
  });
});
