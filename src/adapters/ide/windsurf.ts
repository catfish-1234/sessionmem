import { GenericMCPAdapter } from "../generic.js";

export class WindsurfAdapter extends GenericMCPAdapter {
  name = "Windsurf";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing into Windsurf...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling from Windsurf...");
    return true;
  }
}
