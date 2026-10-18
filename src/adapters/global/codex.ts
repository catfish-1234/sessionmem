import { join, dirname } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import type { AdapterInstallation } from "../contract/hostAdapterContract.js";

/**
 * The TOML block Codex expects in ~/.codex/config.toml. Codex uses TOML, not
 * JSON, so the JSON-based IDEInstaller helpers cannot be reused here.
 */
const CODEX_MCP_BLOCK = `
[mcp_servers.sessionmem]
command = "sessionmem"
args = ["run"]
`;

export class CodexAdapter extends GenericMCPAdapter {
  name = "Codex";

  installation(): AdapterInstallation {
    return { mcp: { path: join(homedir(), ".codex", "config.toml"), command: "sessionmem", args: ["run"], format: "toml" } };
  }

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /** Codex reads AGENTS.md; the global one lives in ~/.codex/AGENTS.md. */
  guidanceTargets(): string[] {
    return [join(homedir(), ".codex", "AGENTS.md")];
  }

  async install(): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync, mkdirSync } =
        await import("fs");
      const configPath = this.installation().mcp.path;
      const existing = existsSync(configPath)
        ? readFileSync(configPath, "utf-8")
        : "";
      // Replace our section so re-install also repairs stale launch commands.
      const withoutServer = existing.replace(/^\s*\[mcp_servers\.sessionmem\][^\S\r\n]*\r?\n[\s\S]*?(?=^\s*\[|$(?![\s\S]))/m, "");

      const dir = dirname(configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Append the TOML block, trimming trailing whitespace to keep a single
      // blank-line separator before our section.
      const updated = withoutServer.trimEnd() + "\n" + CODEX_MCP_BLOCK;
      writeFileSync(configPath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  async uninstall(): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      const configPath = join(homedir(), ".codex", "config.toml");
      if (!existsSync(configPath)) return true;
      const existing = readFileSync(configPath, "utf-8");
      if (!existing.includes("[mcp_servers.sessionmem]")) return true;

      const lines = existing.split("\n");
      const result: string[] = [];
      let i = 0;
      while (i < lines.length) {
        if (lines[i].trim() === "[mcp_servers.sessionmem]") {
          // Skip this section's header and body until the next section header
          // (a line starting with "[") or end of file.
          i++;
          while (i < lines.length && !lines[i].trimStart().startsWith("[")) {
            i++;
          }
          // Drop any trailing blank lines accumulated before the next section.
          while (result.length > 0 && result[result.length - 1].trim() === "") {
            result.pop();
          }
          continue;
        }
        result.push(lines[i]);
        i++;
      }
      const updated = result.join("\n").trimEnd() + "\n";
      writeFileSync(configPath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }
}
