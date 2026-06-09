import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "../ide/installer.js";

export class CodexAdapter extends GenericMCPAdapter {
  name = "Codex";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".codex", "config.json");
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".codex", "config.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
