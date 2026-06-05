import { GenericMCPAdapter } from "../generic.js";

export class ClaudeCodeAdapter extends GenericMCPAdapter {
  name = "Claude Code";

  // Claude Code supports full MCP capability set
  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing to ~/.claude.json...");
    // Inject json config logic
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling from ~/.claude.json...");
    // Cleanup json config logic
    return true;
  }
}
