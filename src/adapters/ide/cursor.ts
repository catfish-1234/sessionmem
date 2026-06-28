import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "./installer.js";

export class CursorAdapter extends GenericMCPAdapter {
  name = "Cursor";

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /**
   * Cursor reads project rules from `.cursor/rules/*.mdc`. A home-level rule
   * file gives every project the sessionmem guidance. The injector seeds
   * `alwaysApply: true` frontmatter on creation so the rule is always active.
   */
  guidanceTargets(): string[] {
    return [join(homedir(), ".cursor", "rules", "sessionmem.mdc")];
  }

  /**
   * Cursor reads MCP servers from `~/.cursor/mcp.json` (global) — NOT from the
   * VS Code-style `Cursor/User/settings.json`, which Cursor ignores for MCP.
   * The path is the same on every platform.
   */
  private get configPath(): string {
    return join(homedir(), ".cursor", "mcp.json");
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
