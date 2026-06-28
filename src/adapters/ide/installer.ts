/**
 * The exact command Claude Code runs at session start. Installed as a
 * `SessionStart` hook in ~/.claude/settings.json so prior memories are injected
 * into every session automatically — the deterministic counterpart to the
 * advisory `startup_inject_memories` tool (which the agent must choose to call).
 */
export const SESSIONMEM_HOOK_COMMAND = "sessionmem session-start";

/**
 * The command Claude Code runs when a session ends. Installed as a `SessionEnd`
 * hook so the session-end pipeline (light retention prune + auto-summarization
 * of any ingested session events) runs automatically once per session, without
 * relying on the agent choosing to call a tool.
 */
export const SESSIONMEM_SESSION_END_HOOK_COMMAND = "sessionmem session-end";

/** Default Claude Code hook event for the legacy 2-arg hook helpers. */
const DEFAULT_HOOK_EVENT = "SessionStart";

interface ClaudeHookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

export class IDEInstaller {
  static parseJsonc(content: string): Record<string, unknown> {
    // Strip single-line comments (//) that appear outside of string literals.
    // A naive regex strips // inside strings (e.g. URLs). This implementation
    // tracks whether we are inside a double-quoted string to avoid that.
    let result = "";
    let inString = false;
    let i = 0;
    while (i < content.length) {
      const ch = content[i];
      if (ch === "\\" && inString) {
        result += content[i] + (content[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        result += ch;
        i++;
        continue;
      }
      if (!inString && ch === "/" && content[i + 1] === "/") {
        while (i < content.length && content[i] !== "\n") i++;
        continue;
      }
      if (!inString && ch === "/" && content[i + 1] === "*") {
        i += 2;
        while (i < content.length) {
          if (content[i] === "*" && content[i + 1] === "/") {
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
      result += ch;
      i++;
    }
    // Strip trailing commas outside of string literals. Doing this with a single
    // regex over the whole string corrupts string values that contain ",]" or
    // ",}"; mirror the inString tracking so only structural commas are removed.
    let cleaned = "";
    let inStr = false;
    let i2 = 0;
    while (i2 < result.length) {
      const c = result[i2];
      if (c === "\\" && inStr) {
        cleaned += result[i2] + (result[i2 + 1] ?? "");
        i2 += 2;
        continue;
      }
      if (c === '"') {
        inStr = !inStr;
        cleaned += c;
        i2++;
        continue;
      }
      if (!inStr && c === ",") {
        // look ahead for optional whitespace then } or ]
        let j = i2 + 1;
        while (
          j < result.length &&
          (result[j] === " " ||
            result[j] === "\n" ||
            result[j] === "\r" ||
            result[j] === "\t")
        )
          j++;
        if (j < result.length && (result[j] === "}" || result[j] === "]")) {
          i2++; // skip the comma
          continue;
        }
      }
      cleaned += c;
      i2++;
    }
    result = cleaned;
    return JSON.parse(result) as Record<string, unknown>;
  }

  static injectMcpBlock(
    content: string,
    serverName: string,
    command: string,
    args: string[],
    extraFields?: Record<string, unknown>,
  ): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};
    if (!config.mcpServers) config.mcpServers = {};
    (config.mcpServers as Record<string, unknown>)[serverName] = {
      command,
      args,
      // Hosts with a richer server schema (e.g. Cline's
      // `disabled` / `autoApprove`) pass those fields through here so the
      // written block matches what the host expects to read.
      ...extraFields,
    };
    return JSON.stringify(config, null, 2);
  }

  static removeMcpBlock(content: string, serverName: string): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};
    if (config.mcpServers) {
      delete (config.mcpServers as Record<string, unknown>)[serverName];
    }
    return JSON.stringify(config, null, 2);
  }

  static async injectMcpConfig(
    filePath: string,
    serverName: string,
    command: string,
    args: string[],
    extraFields?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import(
        "fs"
      );
      const { dirname } = await import("path");
      const existing = existsSync(filePath)
        ? readFileSync(filePath, "utf-8")
        : "{}";
      const updated = this.injectMcpBlock(
        existing,
        serverName,
        command,
        args,
        extraFields,
      );
      // Create the host's config directory if it doesn't exist yet (fresh
      // install, or a config path the host hasn't created). writeFileSync alone
      // throws ENOENT on a missing parent, which previously surfaced as an
      // opaque "config update failed".
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  static async removeMcpConfig(
    filePath: string,
    serverName: string,
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      if (!existsSync(filePath)) return true;
      const existing = readFileSync(filePath, "utf-8");
      const updated = this.removeMcpBlock(existing, serverName);
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  /** True when a SessionStart entry contains a command-hook running `command`. */
  private static hookEntryHasCommand(
    entry: ClaudeHookEntry,
    command: string,
  ): boolean {
    if (!entry || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some((hook) => hook?.command === command);
  }

  /**
   * Merge a Claude Code command hook into a settings.json string, preserving
   * every other key (mcpServers, other hook events, user settings). Defaults to
   * the `SessionStart` event; pass `eventName` for another event (e.g.
   * `SessionEnd`). Idempotent: re-injecting the same command on the same event
   * never produces a duplicate entry.
   */
  static injectClaudeHookBlock(
    content: string,
    command: string,
    eventName: string = DEFAULT_HOOK_EVENT,
  ): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};

    const hooks =
      config.hooks && typeof config.hooks === "object"
        ? (config.hooks as Record<string, unknown>)
        : {};

    const eventEntries = Array.isArray(hooks[eventName])
      ? (hooks[eventName] as ClaudeHookEntry[])
      : [];

    // Drop any pre-existing sessionmem entry so re-install stays idempotent and
    // a stale command form is replaced rather than duplicated.
    const filtered = eventEntries.filter(
      (entry) => !this.hookEntryHasCommand(entry, command),
    );
    filtered.push({ hooks: [{ type: "command", command }] });

    hooks[eventName] = filtered;
    config.hooks = hooks;
    return JSON.stringify(config, null, 2);
  }

  /**
   * Remove a sessionmem command hook from a settings.json string, leaving all
   * other hooks and settings intact. Defaults to the `SessionStart` event.
   * Cleans up the event array and the hooks object when they become empty.
   */
  static removeClaudeHookBlock(
    content: string,
    command: string,
    eventName: string = DEFAULT_HOOK_EVENT,
  ): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};

    const hooks =
      config.hooks && typeof config.hooks === "object"
        ? (config.hooks as Record<string, unknown>)
        : undefined;
    if (!hooks) return JSON.stringify(config, null, 2);

    if (Array.isArray(hooks[eventName])) {
      const filtered = (hooks[eventName] as ClaudeHookEntry[]).filter(
        (entry) => !this.hookEntryHasCommand(entry, command),
      );
      if (filtered.length === 0) {
        delete hooks[eventName];
      } else {
        hooks[eventName] = filtered;
      }
    }

    if (Object.keys(hooks).length === 0) {
      delete config.hooks;
    }
    return JSON.stringify(config, null, 2);
  }

  static async injectClaudeHook(
    filePath: string,
    command: string,
    eventName: string = DEFAULT_HOOK_EVENT,
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import(
        "fs"
      );
      const { dirname } = await import("path");
      const existing = existsSync(filePath)
        ? readFileSync(filePath, "utf-8")
        : "{}";
      const updated = this.injectClaudeHookBlock(existing, command, eventName);
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  static async removeClaudeHook(
    filePath: string,
    command: string,
    eventName: string = DEFAULT_HOOK_EVENT,
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      if (!existsSync(filePath)) return true;
      const existing = readFileSync(filePath, "utf-8");
      const updated = this.removeClaudeHookBlock(existing, command, eventName);
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }
}
