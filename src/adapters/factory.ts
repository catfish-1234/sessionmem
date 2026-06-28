import type { HostAdapterContract } from "./contract/hostAdapterContract.js";

// We will implement these adapters shortly
import { ClaudeCodeAdapter } from "./global/claudeCode.js";
import { AntigravityAdapter } from "./global/antigravity.js";
import { CursorAdapter } from "./ide/cursor.js";
import { WindsurfAdapter } from "./ide/windsurf.js";
import { ClineAdapter } from "./ide/cline.js";
import { GenericMCPAdapter } from "./generic.js";
import { CodexAdapter } from "./global/codex.js";
import { QCoderAdapter } from "./global/qcoder.js";

/**
 * Canonical adapter names accepted by `--adapter <name>` / SESSIONMEM_ADAPTER.
 * Kept in sync with {@link AdapterFactory.forName}; surfaced to the CLI for the
 * install command's choices list.
 */
export const ADAPTER_NAMES = [
  "claude-code",
  "cursor",
  "windsurf",
  "cline",
  "codex",
  "antigravity",
  "qcoder",
  "generic",
] as const;

export type AdapterName = (typeof ADAPTER_NAMES)[number];

export class AdapterFactory {
  /**
   * Detect the current host environment and return the appropriate adapter.
   *
   * Detection keys are the REAL environment variables each host sets, verified
   * against live shells:
   *  - Claude Code sets `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, and
   *    `CLAUDE_CODE_SESSION_ID=...` (note the `_ID` suffix). `TERM_PROGRAM` is
   *    the HOST terminal (e.g. `vscode`), never `"claude-code"`. The previous
   *    `CLAUDE_CODE_SESSION` / `TERM_PROGRAM === "claude-code"` check never
   *    matched, so the SessionStart-hook install path was never selected.
   *  - Antigravity sets `ANTIGRAVITY_APP_DATA_DIR` / `ANTIGRAVITY_SESSION_ID`
   *    (and leaks `ANTIGRAVITY_CLI_ALIAS`); checked first so its own CLI wins in
   *    its own shell.
   */
  static detectAdapter(): HostAdapterContract {
    const env = process.env;

    if (env.ANTIGRAVITY_APP_DATA_DIR || env.ANTIGRAVITY_SESSION_ID) {
      return new AntigravityAdapter();
    }

    if (
      env.CLAUDECODE === "1" ||
      env.CLAUDE_CODE_ENTRYPOINT !== undefined ||
      env.CLAUDE_CODE_SESSION_ID !== undefined
    ) {
      return new ClaudeCodeAdapter();
    }

    if (
      env.CURSOR_AGENT !== undefined ||
      env.CURSOR_CLI !== undefined ||
      env.CURSOR_TRACE_ID !== undefined
    ) {
      return new CursorAdapter();
    }

    // Windsurf is a VS Code fork with no unique env var; --adapter windsurf
    // required. No reliable auto-detection branch.

    // Cline is a VS Code extension; auto-detection is impossible. Use
    // --adapter cline.

    // Codex sets CODEX_HOME (and may expose OPENAI_CODEX). CODEX_SESSION_ID was
    // unverified and never matched.
    if (env.CODEX_HOME !== undefined || env.OPENAI_CODEX !== undefined) {
        return new CodexAdapter();
    }

    if (env.QCODER_SESSION) {
        return new QCoderAdapter();
    }

    // Fallback to generic MCP if no specific host is detected
    return new GenericMCPAdapter();
  }

  /**
   * Resolve an adapter by its canonical name. Powers the `--adapter <name>`
   * install flag and the `SESSIONMEM_ADAPTER` override so a user can force a
   * host explicitly when auto-detection cannot (e.g. installing from a plain
   * terminal that is not inside any host). Throws on an unknown name so the CLI
   * can surface a clear error rather than silently falling back to generic.
   */
  static forName(name: string): HostAdapterContract {
    switch (name as AdapterName) {
      case "claude-code":
        return new ClaudeCodeAdapter();
      case "cursor":
        return new CursorAdapter();
      case "windsurf":
        return new WindsurfAdapter();
      case "cline":
        return new ClineAdapter();
      case "codex":
        return new CodexAdapter();
      case "antigravity":
        return new AntigravityAdapter();
      case "qcoder":
        return new QCoderAdapter();
      case "generic":
        return new GenericMCPAdapter();
      default:
        throw new Error(
          `Unknown adapter "${name}". Valid adapters: ${ADAPTER_NAMES.join(", ")}.`,
        );
    }
  }
}
