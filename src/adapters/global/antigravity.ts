import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "../ide/installer.js";

export class AntigravityAdapter extends GenericMCPAdapter {
  name = "Antigravity";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".antigravity", "config.json");
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".antigravity", "config.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
