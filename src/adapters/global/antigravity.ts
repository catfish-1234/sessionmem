import { GenericMCPAdapter } from "../generic.js";

export class AntigravityAdapter extends GenericMCPAdapter {
  name = "Antigravity";

  capabilities = {
    supportsPrompts: true, // Assuming full MCP capabilities
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing for Antigravity...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling for Antigravity...");
    return true;
  }
}
