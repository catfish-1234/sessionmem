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
  CLAUDE_CODE_SESSION: undefined,
  TERM_PROGRAM: undefined,
  CURSOR_APP_VERSION: undefined,
  CLINE_SESSION_ID: undefined,
  CODEX_SESSION_ID: undefined,
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

  it("returns ClaudeCodeAdapter when CLAUDE_CODE_SESSION is set", () => {
    withEnv({ ...CLEAR_ALL, CLAUDE_CODE_SESSION: "1" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Claude Code");
    });
  });

  it("returns ClaudeCodeAdapter when TERM_PROGRAM is claude-code", () => {
    withEnv({ ...CLEAR_ALL, TERM_PROGRAM: "claude-code" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Claude Code");
    });
  });

  it("returns CursorAdapter when CURSOR_APP_VERSION is set", () => {
    withEnv({ ...CLEAR_ALL, CURSOR_APP_VERSION: "0.46.0" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Cursor");
    });
  });

  it("returns CursorAdapter when TERM_PROGRAM is Cursor", () => {
    withEnv({ ...CLEAR_ALL, TERM_PROGRAM: "Cursor" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Cursor");
    });
  });

  it("returns WindsurfAdapter when TERM_PROGRAM is Windsurf", () => {
    withEnv({ ...CLEAR_ALL, TERM_PROGRAM: "Windsurf" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Windsurf");
    });
  });

  it("returns ClineAdapter when CLINE_SESSION_ID is set", () => {
    withEnv({ ...CLEAR_ALL, CLINE_SESSION_ID: "cline-123" }, () => {
      const adapter = AdapterFactory.detectAdapter();
      expect(adapter.name).toBe("Cline");
    });
  });

  it("returns CodexAdapter when CODEX_SESSION_ID is set", () => {
    withEnv({ ...CLEAR_ALL, CODEX_SESSION_ID: "codex-123" }, () => {
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
      { ...CLEAR_ALL, ANTIGRAVITY_SESSION_ID: "a", CLAUDE_CODE_SESSION: "b" },
      () => {
        const adapter = AdapterFactory.detectAdapter();
        expect(adapter.name).toBe("Antigravity");
      },
    );
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
