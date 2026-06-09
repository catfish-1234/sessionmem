import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "./installer.js";

export class CursorAdapter extends GenericMCPAdapter {
  name = "Cursor";

  capabilities = {
    supportsPrompts: false,
    supportsResources: false,
    supportsTools: true,
  };

  private get configPath(): string {
    const home = homedir();
    if (process.platform === "win32") {
      return join(
        process.env.APPDATA ?? home,
        "Cursor",
        "User",
        "settings.json",
      );
    }
    if (process.platform === "darwin") {
      return join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "settings.json",
      );
    }
    return join(home, ".config", "Cursor", "User", "settings.json");
  }

  async install(): Promise<boolean> {
    return IDEInstaller.injectMcpConfig(
      this.configPath,
      "sessionmem",
      "sessionmem",
      ["run"],
    );
  }

  async uninstall(): Promise<boolean> {
    return IDEInstaller.removeMcpConfig(this.configPath, "sessionmem");
  }
}
