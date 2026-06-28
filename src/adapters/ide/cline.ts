import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "./installer.js";

/**
 * VS Code variants Cline can be installed into, in detection-priority order.
 * The globalStorage path differs only by this editor-name segment.
 */
const VSCODE_EDITOR_VARIANTS = [
  "Code",
  "Code - Insiders",
  "VSCodium",
  "Cursor",
] as const;

export class ClineAdapter extends GenericMCPAdapter {
  name = "Cline";

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /** Cline reads global rules from ~/Documents/Cline/Rules/. */
  guidanceTargets(): string[] {
    return [join(homedir(), "Documents", "Cline", "Rules", "sessionmem.md")];
  }

  /**
   * Cline (the VS Code extension `saoudrizwan.claude-dev`) stores MCP servers in
   * `cline_mcp_settings.json` under the editor's globalStorage — NOT in a
   * `~/.cline/config.json`. The base dir differs per platform:
   *  - macOS:   ~/Library/Application Support/Code/User/globalStorage/...
   *  - Windows: %APPDATA%\Code\User\globalStorage\...
   *  - Linux:   ~/.config/Code/User/globalStorage/...
   */
  private get configPath(): string {
    const home = homedir();
    let base: string;
    if (process.platform === "win32") {
      base = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    } else if (process.platform === "darwin") {
      base = join(home, "Library", "Application Support");
    } else {
      base = join(home, ".config");
    }
    const rest = [
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    ];
    // "Code" is VS Code stable, but Cline also installs into Insiders, VSCodium,
    // and Cursor. Pick the first variant whose globalStorage dir already exists;
    // fall back to stable "Code" when none is found (fresh install).
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    // `name` is from the hardcoded VSCODE_EDITOR_VARIANTS constant above — not user input.
    const editorName =
      VSCODE_EDITOR_VARIANTS.find((name) =>
        existsSync(join(base, name, "User", "globalStorage")),
      ) ?? "Code";
    return join(base, editorName, ...rest);
  }

  async install(): Promise<boolean> {
    // Cline's server schema carries `disabled` and `autoApprove` alongside
    // command/args; pass them through so the written block matches what Cline
    // expects to read.
    return IDEInstaller.injectMcpConfig(
      this.configPath,
      "sessionmem",
      "sessionmem",
      ["run"],
      { disabled: false, autoApprove: [] },
    );
  }

  async uninstall(): Promise<boolean> {
    return IDEInstaller.removeMcpConfig(this.configPath, "sessionmem");
  }
}
