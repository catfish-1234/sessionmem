import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AdapterInstallation } from "./contract/hostAdapterContract.js";
import { IDEInstaller, isManagedClaudeHook } from "./ide/installer.js";
import { AUTOMATIC_MEMORY_TOOLS } from "./ide/cline.js";
import { generateClaudeMdBlock } from "./claudeMdInjector.js";
import type { HostAdapterContract } from "./contract/hostAdapterContract.js";
import { resolveDbPath } from "../cli/context.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function checkHooks(installation: AdapterInstallation): string {
  const expected = installation.hooks;
  if (!expected) return "This host has no installed lifecycle hooks; recall uses agent instructions";
  const config = IDEInstaller.parseJsonc(readFileSync(expected.path, "utf8"));
  if (config.disableAllHooks === true) throw new Error("Claude Code has disableAllHooks enabled");
  const hooks = object(config.hooks);
  for (const spec of expected.entries) {
    const entries = Array.isArray(hooks[spec.event]) ? hooks[spec.event] as unknown[] : [];
    const managed = entries.flatMap((value) => {
      const entry = object(value);
      return Array.isArray(entry.hooks) ? entry.hooks.filter((value) => isManagedClaudeHook(object(value).command, spec.command)).map((hook) => ({ entry, hook: object(hook) })) : [];
    });
    const matches = managed.filter(({ entry, hook }) => {
      if (entry.matcher !== spec.matcher || entry.async === true) return false;
      return hook.type === "command" && hook.command === spec.command && hook.async !== true;
    });
    if (managed.length !== 1 || matches.length !== 1) throw new Error(`${spec.event} hook is missing, duplicated, or differs from the current definition`);
  }
  return `${expected.entries.map(entry => entry.event).join(", ")} match current hook definitions (${expected.path})`;
}

export function checkAgentGuidance(adapter: HostAdapterContract): string {
  const paths = adapter.guidanceTargets?.() ?? [];
  if (!paths.length) throw new Error("No agent guidance target is configured");
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    if (!text.includes(generateClaudeMdBlock())) throw new Error(`Agent guidance missing or stale (${path})`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (path.endsWith(".mdc") && (!frontmatter || !/^alwaysApply:\s*true\s*$/m.test(frontmatter[1]))) {
      throw new Error(`Cursor rule is not always active (${path})`);
    }
  }
  if (adapter.name === "Cline") {
    const installation = adapter.installation?.();
    const config = IDEInstaller.parseJsonc(readFileSync(installation!.mcp.path, "utf8"));
    const approved = object(object(config.mcpServers).sessionmem).autoApprove;
    if (!Array.isArray(approved) || AUTOMATIC_MEMORY_TOOLS.some(tool => !approved.includes(tool))) {
      throw new Error("Automatic memory tools require approval; reinstall to configure the local lookup and capture allowlist");
    }
  }
  return `Current startup, prompt and decision-save instructions (${paths.join(", ")})`;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Check the installed launch entry before executing the known local command. */
export function readMcpLaunch(installation: AdapterInstallation): McpLaunch {
  const expected = installation.mcp;
  const content = readFileSync(expected.path, "utf8");
  let entry: Record<string, unknown>;
  if (expected.format === "toml") {
    // The Codex installer writes this small TOML section with JSON-compatible
    // quoted values. Refuse unfamiliar syntax rather than claiming it works.
    const section = content.match(/^\s*\[mcp_servers\.sessionmem\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m)?.[1];
    if (!section) throw new Error("sessionmem MCP section is missing");
    if (/^\s*\[mcp_servers\.sessionmem\./m.test(content) || /^\s*(?:env|env_vars|cwd|url)\s*=/m.test(section)) {
      throw new Error("Custom Codex launch settings require manual verification; doctor supports the installer-generated command and args");
    }
    if (/^\s*enabled\s*=\s*false\s*$/m.test(section)) throw new Error("sessionmem MCP server is disabled");
    entry = {
      command: JSON.parse(section.match(/^\s*command\s*=\s*(.+)$/m)?.[1] ?? "null"),
      args: JSON.parse(section.match(/^\s*args\s*=\s*(.+)$/m)?.[1] ?? "null"),
    };
  } else {
    const config = IDEInstaller.parseJsonc(content);
    entry = object(object(config.mcpServers).sessionmem);
  }
  if (entry.disabled === true) throw new Error("sessionmem MCP server is disabled");
  if (entry.type !== undefined && entry.type !== "stdio") throw new Error("sessionmem MCP server must use the local stdio transport");
  if (entry.command !== expected.command || JSON.stringify(entry.args) !== JSON.stringify(expected.args)) {
    throw new Error(`sessionmem MCP launch entry differs from the current definition (${expected.path})`);
  }
  if (entry.env !== undefined && (entry.env === null || typeof entry.env !== "object" || Array.isArray(entry.env))) {
    throw new Error("sessionmem MCP environment must be an object");
  }
  const env = object(entry.env);
  if (Object.values(env).some((value) => typeof value !== "string")) {
    throw new Error("sessionmem MCP environment values must be strings");
  }
  return { command: expected.command, args: expected.args, env: env as Record<string, string> };
}

export async function probeMcpWiring(launch: McpLaunch, dbPath: string, version: string): Promise<void> {
  if (launch.env?.SESSIONMEM_DB_PATH && resolve(resolveDbPath(launch.env.SESSIONMEM_DB_PATH)) !== resolve(dbPath)) {
    throw new Error("MCP configuration selects a different SESSIONMEM_DB_PATH; run doctor with that path");
  }
  const inherited = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: "sessionmem-doctor", version });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...inherited, ...launch.env, SESSIONMEM_DB_PATH: dbPath, SESSIONMEM_DIAGNOSTIC_PROBE: "1" },
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: 5000 });
    const server = client.getServerVersion();
    if (server?.name !== "sessionmem" || server.version !== version) {
      throw new Error(`MCP server version does not match sessionmem ${version}`);
    }
    const tools = await client.listTools({}, { timeout: 5000 });
    for (const name of ["stats", "storeMemory", "retrieveMemories", "searchMemoryIndex", "memoryTimeline", "getMemory"]) {
      if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`MCP tool ${name} is missing`);
    }
    const result = await client.callTool({ name: "stats", arguments: {} }, undefined, { timeout: 5000 });
    const payload = Array.isArray(result.content) ? object(result.content.find((part: unknown) => object(part).type === "text")) : {};
    if (result.isError || typeof payload.text !== "string" || !JSON.parse(payload.text).ok) {
      throw new Error("MCP stats tool failed");
    }
  } finally {
    await transport.close();
  }
}
