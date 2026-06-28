import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import { IDEInstaller } from "../ide/installer.js";

// ⚠️ UNVERIFIED MCP CONFIG PATH — see audit round 18.
// The real product is "Qoder" (Alibaba's agentic AI IDE, a VS Code fork), not
// "QCoder", and it is NOT a Google tool / not "Project IDX" (IDX became Firebase
// Studio). Qoder configures MCP servers through its in-IDE Settings UI; the
// underlying global config FILE PATH is NOT publicly documented as of 2026-06.
// Qoder's published config snippet does use the standard
// `{ "mcpServers": { command, args, env } }` schema that
// IDEInstaller.injectMcpConfig writes, so the JSON STRUCTURE here is correct —
// but `~/.qoder/config.json` (let alone the current misspelled `~/.qcoder/...`)
// is an EDUCATED GUESS. If Qoder reads MCP config from a different file, this
// install() is a silent no-op for the host. TODO: confirm against a real Qoder
// install (Qoder Settings → MCP → "View raw config") and correct the path +
// directory spelling, or wire it through the UI-managed store if no file exists.
export class QCoderAdapter extends GenericMCPAdapter {
  name = "QCoder";

  // Capabilities inherited from GenericMCPAdapter (tools only).

  /** QCoder reads AGENTS.md-style guidance from its global config dir. */
  guidanceTargets(): string[] {
    return [join(homedir(), ".qcoder", "AGENTS.md")];
  }

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".qcoder", "config.json");
    return IDEInstaller.injectMcpConfig(configPath, "sessionmem", "sessionmem", [
      "run",
    ]);
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".qcoder", "config.json");
    return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
  }
}
