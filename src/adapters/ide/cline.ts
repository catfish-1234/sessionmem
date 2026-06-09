import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "./installer.js";

export class ClineAdapter extends GenericMCPAdapter {
  name = "Cline";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".cline", "config.json");
    return IDEInstaller.injectMcpConfig(
      configPath,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".cline", "config.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
