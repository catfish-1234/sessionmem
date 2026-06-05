import { GenericMCPAdapter } from "../generic.js";

export class ClineAdapter extends GenericMCPAdapter {
  name = "Cline";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing into Cline...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling from Cline...");
    return true;
  }
}
