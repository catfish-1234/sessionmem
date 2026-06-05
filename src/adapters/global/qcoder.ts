import { GenericMCPAdapter } from "../generic.js";

export class QCoderAdapter extends GenericMCPAdapter {
  name = "QCoder";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    console.log("Installing for QCoder...");
    return true;
  }

  async uninstall(): Promise<boolean> {
    console.log("Uninstalling for QCoder...");
    return true;
  }
}
