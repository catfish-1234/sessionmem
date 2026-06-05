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

export class AdapterFactory {
  /**
   * Detect the current host environment and return the appropriate adapter.
   */
  static detectAdapter(): HostAdapterContract {
    const env = process.env;

    if (env.ANTIGRAVITY_APP_DATA_DIR || env.ANTIGRAVITY_SESSION_ID) {
      return new AntigravityAdapter();
    }

    if (env.CLAUDE_CODE_SESSION || env.TERM_PROGRAM === "claude-code") {
      return new ClaudeCodeAdapter();
    }

    if (env.TERM_PROGRAM === "Cursor" || env.CURSOR_APP_VERSION) {
      return new CursorAdapter();
    }

    if (env.TERM_PROGRAM === "Windsurf") {
      return new WindsurfAdapter();
    }
    
    if (env.CLINE_SESSION_ID) {
        return new ClineAdapter();
    }

    if (env.CODEX_SESSION_ID) {
        return new CodexAdapter();
    }

    if (env.QCODER_SESSION) {
        return new QCoderAdapter();
    }

    // Fallback to generic MCP if no specific host is detected
    return new GenericMCPAdapter();
  }
}
