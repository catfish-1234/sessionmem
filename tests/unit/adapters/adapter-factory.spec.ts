import { describe, it, expect } from "vitest";
import { AdapterFactory } from "../../../src/adapters/factory.js";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const originals: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    originals[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

const CLEAR_ALL = {
  ANTIGRAVITY_APP_DATA_DIR: undefined,
  ANTIGRAVITY_SESSION_ID: undefined,
  // Real Claude Code env vars (the process running these tests may itself be a
  // Claude Code session, so they must be cleared for the other-host cases).
  CLAUDECODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CLAUDE_CODE_SESSION_ID: undefined,
  TERM_PROGRAM: undefined,
  CURSOR_APP_VERSION: undefined,
  CURSOR_AGENT: undefined,
  CURSOR_CLI: undefined,
  CURSOR_TRACE_ID: undefined,
  CLINE_SESSION_ID: undefined,
  CODEX_SESSION_ID: undefined,
  CODEX_HOME: undefined,
  OPENAI_CODEX: undefined,
  QCODER_SESSION: undefined,
};

describe("AdapterFactory.detectAdapter", () => {
  it("returns AntigravityAdapter when ANTIGRAVITY_SESSION_ID is set", () => {
    withEnv({ ...CLEAR_ALL, ANTIGRAVITY_SESSION_ID: "test-session" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Antigravity");
    });
  });

  it("returns AntigravityAdapter when ANTIGRAVITY_APP_DATA_DIR is set", () => {
    withEnv({ ...CLEAR_ALL, ANTIGRAVITY_APP_DATA_DIR: "/data" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Antigravity");
    });
  });

  it("returns ClaudeCodeAdapter when CLAUDECODE is 1", () => {
    withEnv({ ...CLEAR_ALL, CLAUDECODE: "1" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Claude Code");
    });
  });

  it("returns ClaudeCodeAdapter when CLAUDE_CODE_ENTRYPOINT is set", () => {
    withEnv({ ...CLEAR_ALL, CLAUDE_CODE_ENTRYPOINT: "cli" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Claude Code");
    });
  });

  it("returns ClaudeCodeAdapter when CLAUDE_CODE_SESSION_ID is set (with VSCode TERM_PROGRAM)", () => {
    withEnv(
      { ...CLEAR_ALL, CLAUDE_CODE_SESSION_ID: "abc", TERM_PROGRAM: "vscode" },
      () => {
        const adapter = AdapterFactory.detectAdapter();
        expect(adapter.name).toBe("Claude Code");
      },
    );
  });

  it("returns CursorAdapter when CURSOR_AGENT is set", () => {
    withEnv({ ...CLEAR_ALL, CURSOR_AGENT: "1" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Cursor");
    });
  });

  it("returns CursorAdapter when CURSOR_TRACE_ID is set", () => {
    withEnv({ ...CLEAR_ALL, CURSOR_TRACE_ID: "trace-abc" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Cursor");
    });
  });

  it("does NOT auto-detect Windsurf (VS Code fork, no unique env var)", () => {
    withEnv({ ...CLEAR_ALL, TERM_PROGRAM: "Windsurf" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Generic MCP");
    });
  });

  it("does NOT auto-detect Cline (VS Code extension, no env var)", () => {
    withEnv({ ...CLEAR_ALL, CLINE_SESSION_ID: "cline-123" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Generic MCP");
    });
  });

  it("returns CodexAdapter when CODEX_HOME is set", () => {
    withEnv({ ...CLEAR_ALL, CODEX_HOME: "/home/.codex" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Codex");
    });
  });

  it("returns QCoderAdapter when QCODER_SESSION is set", () => {
    withEnv({ ...CLEAR_ALL, QCODER_SESSION: "qcoder-abc" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("QCoder");
    });
  });

  it("falls back to Generic MCP when no env vars match", () => {
    withEnv(CLEAR_ALL, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Generic MCP");
    });
  });

  it("Antigravity takes priority over Claude Code when both set", () => {
    withEnv(
      { ...CLEAR_ALL, ANTIGRAVITY_SESSION_ID: "a", CLAUDECODE: "1" },
      () => {
        const adapter = AdapterFactory.detectAdapter();
        expect(adapter.name).toBe("Antigravity");
      },
    );
  });

  it("resolves an explicit adapter name via forName", () => {
    expect(AdapterFactory.forName("claude-code").name).toBe("Claude Code");
    expect(AdapterFactory.forName("cursor").name).toBe("Cursor");
    expect(AdapterFactory.forName("generic").name).toBe("Generic MCP");
  });

  it("throws on an unknown adapter name", () => {
    expect(() => AdapterFactory.forName("nope")).toThrow(/Unknown adapter/);
  });

  it("detected adapter implements startMcpServer", () => {
    withEnv(CLEAR_ALL, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(typeof adapter.startMcpServer).toBe("function");
    });
  });

  it("detected adapter exposes capabilities object", () => {
    withEnv(CLEAR_ALL, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.capabilities).toHaveProperty("supportsTools");
      expect(adapter.capabilities).toHaveProperty("supportsPrompts");
      expect(adapter.capabilities).toHaveProperty("supportsResources");
    });
  });
});
