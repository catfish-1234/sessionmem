import { GenericMCPAdapter } from "../generic.js";

export class CodexAdapter extends GenericMCPAdapter {
  name = "Codex";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing for Codex...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling for Codex...");
    return true;
  }
}
