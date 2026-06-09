import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "../ide/installer.js";

export class ClaudeCodeAdapter extends GenericMCPAdapter {
  name = "Claude Code";

  capabilities = {
    supportsPrompts: true,
    supportsResources: true,
    supportsTools: true,
  };

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".claude.json");
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".claude.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
