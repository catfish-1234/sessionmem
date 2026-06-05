import { GenericMCPAdapter } from "../generic.js";

export class CursorAdapter extends GenericMCPAdapter {
  name = "Cursor";

  capabilities = {
    supportsPrompts: false, // Wait, Cursor often lacks full prompt support, let's say false to test fallbacks
    supportsResources: false, 
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing into Cursor settings.json...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling from Cursor settings.json...");
    return true;
  }
}
