import { join } from "path";
import { homedir } from "os";
import { GenericMCPAdapter } from "../generic.js";
import {
  IDEInstaller,
  SESSIONMEM_HOOK_COMMAND,
  SESSIONMEM_SESSION_END_HOOK_COMMAND,
} from "../ide/installer.js";

export class ClaudeCodeAdapter extends GenericMCPAdapter {
  name = "Claude Code";

  // Capabilities inherited from GenericMCPAdapter (tools only) so the
  // fetch_memories fallback tool is registered.

  // The installed SessionStart hook already injects prior context at the start
  // of every session, so suppress the startup_inject_memories tool: an agent
  // calling it on top of the hook would double-inject content and double-count
  // access_count increments.
  protected suppressStartupInjectionTool = true;

  /**
   * Claude Code reads ~/.claude/CLAUDE.md as global memory on every session
   * across all projects — the right place for the sessionmem guidance block.
   */
  guidanceTargets(): string[] {
    return [join(homedir(), ".claude", "CLAUDE.md")];
  }

  private settingsPath(): string {
    return join(homedir(), ".claude", "settings.json");
  }

  async install(): Promise<boolean> {
    const configPath = join(homedir(), ".claude.json");

    // On Windows, the globally-installed `sessionmem` bin is a `.cmd` shim.
    // Claude Code spawns MCP servers WITHOUT a shell, and `.cmd` shims require
    // cmd.exe to execute, so a bare `command: "sessionmem"` fails to start.
    // Route through `cmd /c sessionmem run` so the shim is resolved correctly.
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "sessionmem";
    const args = isWindows ? ["/c", "sessionmem", "run"] : ["run"];

    const mcpOk = await IDEInstaller.injectMcpConfig(
      configPath,
      "sessionmem",
      command,
      args,
    );

    // Register a SessionStart hook so prior memories are injected automatically
    // at the start of EVERY Claude Code session. This is the deterministic
    // auto-injection path the advisory `startup_inject_memories` tool could
    // never guarantee: a hook runs unconditionally and Claude Code adds its
    // output to the session context without the agent choosing to call a tool.
    // A hook-wiring failure now propagates so the install command reports a
    // failure if the SessionStart/SessionEnd hooks could not be written.
    const startHookOk = await IDEInstaller.injectClaudeHook(
      this.settingsPath(),
      SESSIONMEM_HOOK_COMMAND,
    );

    // Register a SessionEnd hook so the session-end pipeline (light retention
    // prune + auto-summarization of ingested session events) runs once when a
    // session ends — the deterministic write-side counterpart to the
    // SessionStart read-side hook.
    const endHookOk = await IDEInstaller.injectClaudeHook(
      this.settingsPath(),
      SESSIONMEM_SESSION_END_HOOK_COMMAND,
      "SessionEnd",
    );

    return mcpOk && startHookOk && endHookOk;
  }

  async uninstall(): Promise<boolean> {
    const configPath = join(homedir(), ".claude.json");
    const mcpOk = await IDEInstaller.removeMcpConfig(configPath, "sessionmem");
    // Propagate hook-removal results so a failure to clean up either hook is
    // reported as an uninstall failure rather than silently ignored.
    const startOk = await IDEInstaller.removeClaudeHook(
      this.settingsPath(),
      SESSIONMEM_HOOK_COMMAND,
    );
    const endOk = await IDEInstaller.removeClaudeHook(
      this.settingsPath(),
      SESSIONMEM_SESSION_END_HOOK_COMMAND,
      "SessionEnd",
    );
    return mcpOk && startOk && endOk;
  }
}
