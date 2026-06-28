import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "./installer.js";

export class WindsurfAdapter extends GenericMCPAdapter {
  name = "Windsurf";

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /** Windsurf reads global rules from ~/.codeium/windsurf/memories/global_rules.md. */
  guidanceTargets(): string[] {
    return [
      join(homedir(), ".codeium", "windsurf", "memories", "global_rules.md"),
    ];
  }

  /**
   * Windsurf reads MCP servers from `~/.codeium/windsurf/mcp_config.json` — NOT
   * from the VS Code-style `Windsurf/User/settings.json`. Same path on every
   * platform (mirrors the `.codeium/windsurf` root the guidance file already
   * uses).
   */
  private get configPath(): string {
    return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
  }

  async install(): Promise<boolean> {
    return IDEInstaller.injectMcpConfig(
      this.configPath,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
  }

  async uninstall(): Promise<boolean> {
    return IDEInstaller.removeMcpConfig(this.configPath, "sessionmem");
  }
}
