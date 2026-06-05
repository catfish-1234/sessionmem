# Phase 4 Context

**Phase:** 4 - Multi-Platform Adapter Rollout
**Status:** Defined

## Decisions

### 1. Host Detection & Installation
- **Auto-inject:** Auto-find and inject MCP configuration into all discovered IDE config files (Cursor, Windsurf) for seamless UX.
- **Global Configs:** For Claude Code and Antigravity, auto-update their global configuration files (e.g., `~/.claude.json`).
- **Unknown Hosts:** Start basic stdio MCP anyway; host might work.
- **Uninstall:** Add uninstaller that cleans out all injected IDE configs.

### 2. Missing Host Capabilities
- **No Resources:** Fallback to a `fetch_memories` tool call if the host lacks MCP resource support.
- **No Prompts:** Rely on an auto-run tool call for startup memory injection if prompts aren't supported.
- **Basic Host:** Ensure all memory actions can gracefully degrade to pure tool calls.
- **Disconnect:** Log a warning and keep running if the host drops the connection mid-session.

### 3. Manual Configuration Fallback
- **Failure UX:** Print an exact copy-paste JSON block if auto-config fails.
- **Command:** Use `sessionmem run` to start the basic stdio MCP server.
- **Testing:** Provide a `sessionmem ping` tool to help users test their manual configuration.
- **Logging:** Log manual MCP runs to `~/.sessionmem/logs/mcp.log` for debugging visibility.

## Code Context
- Adapters should wrap the core SQLite memory engine (`src/core/`) built in Phase 1-3.
- CLI lifecycle logic for install/uninstall will be built on these decisions.
