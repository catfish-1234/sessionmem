import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "../ide/installer.js";

// ⚠️ UNVERIFIED: The MCP config path for "Antigravity" has not been confirmed
// against official documentation. `~/.gemini/config/mcp_config.json` is the
// real path for Gemini CLI, and may apply if Antigravity is a Gemini-family
// tool. Verify before relying on this adapter for production installs.
// The `{ "mcpServers": { ... } }` structure IDEInstaller writes is consistent
// with Gemini CLI's documented MCP config format.
const ANTIGRAVITY_MCP_CONFIG = [".gemini", "config", "mcp_config.json"] as const;

export class AntigravityAdapter extends GenericMCPAdapter {
  name = "Antigravity";

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /** Antigravity reads AGENTS.md-style guidance from its global config dir. */
  guidanceTargets(): string[] {
    return [join(homedir(), ".antigravity", "AGENTS.md")];
  }

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ...ANTIGRAVITY_MCP_CONFIG);
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ...ANTIGRAVITY_MCP_CONFIG);
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
