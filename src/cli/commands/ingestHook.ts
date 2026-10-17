import { createCliContext, type CliContext } from "../context.js";
import { randomUUID } from "node:crypto";
import { buildToolEvent } from "../../core/capture/toolEvent.js";

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  session_id?: string;
  cwd?: string;
}

/** Emit a hook diagnostic to stderr when SESSIONMEM_DEBUG=1. */
function debug(message: string): void {
  if (process.env.SESSIONMEM_DEBUG === "1") {
    process.stderr.write(`[sessionmem] ingest-hook: ${message}\n`);
  }
}

async function readStdinJson(): Promise<HookPayload> {
  if (process.stdin.isTTY) return {};
  return new Promise<HookPayload>((resolve) => {
    let data = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(data) as HookPayload); } catch { resolve({}); }
    };
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      finish();
    }, 500);
    timer.unref?.();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => { clearTimeout(timer); finish(); });
    process.stdin.on("error", () => { clearTimeout(timer); finish(); });
  });
}

function resolveSessionId(payload: HookPayload): string {
  if (typeof payload.session_id === "string" && payload.session_id.trim()) {
    return payload.session_id.trim();
  }
  return process.env.CLAUDE_CODE_SESSION_ID ?? process.env.SESSION_ID ?? `session-${Date.now()}`;
}

/**
 * `sessionmem ingest-hook` — PostToolUse hook handler.
 * Reads Claude Code's PostToolUse JSON payload from stdin and stores it as a
 * session event so the SessionEnd auto-summarizer has material to work with.
 * Also auto-stores git commits as decision memories (git commit detection).
 */
export async function ingestHookCommand(ctx?: CliContext): Promise<void> {
  let context: CliContext | undefined;
  try {
    const payload = await readStdinJson();
    const toolName = payload.tool_name ?? "";

    const event = buildToolEvent(toolName, payload.tool_input, payload.cwd);
    if (!event) {
      debug(`skipped: tool "${toolName}" is not captured`);
      return;
    }

    context = ctx ?? createCliContext();
    const sessionId = resolveSessionId(payload);
    const projectId = context.projectId;

    // eventIndex is intentionally omitted: the service assigns the next free
    // index per session inside an immediate transaction, so parallel tool calls
    // cannot collide (see nextSessionEventIndex).
    const result = await context.service.call("ingestSessionEvents", {
      projectId,
      sessionId,
      events: [{
        id: randomUUID(),
        ...event,
      }],
    });

    if (!result.ok) {
      debug(`ingest failed: ${result.error.message}`);
    } else {
      debug(`ingested ${result.ingested} event(s) for session ${sessionId} (project ${projectId})`);
    }

    // Git commit detection: auto-store as a decision memory.
    if (toolName === "Bash") {
      const cmd = typeof payload.tool_input?.command === "string"
        ? payload.tool_input.command
        : "";
      const commitMatch = cmd.match(/git\s+commit[^|&;]*(?:-m\s+['"]([^'"]+)['"]|--message=?['"]([^'"]+)['"])/);
      if (commitMatch) {
        const message = (commitMatch[1] ?? commitMatch[2] ?? "").trim();
        if (message) {
          await context.service.call("storeMemory", {
            projectId,
            sessionId,
            memoryId: `gitcommit-${Date.now()}`,
            sourceAdapter: "sessionmem-hook",
            kind: "decision",
            content: `Git commit: ${message}`,
            importance: 5,
          });
        }
      }
    }
  } catch (err) {
    // Never block tool use — a hook failure must not surface as a tool error.
    debug(err instanceof Error ? err.message : String(err));
  } finally {
    // Close only a context this command opened; an injected ctx belongs to the
    // caller (tests reuse it across assertions). Previously the close was
    // inside the try block, so it was skipped on every error path and leaked
    // the sqlite handle.
    if (!ctx && context) {
      try { context.db.close(); } catch { /* already closed */ }
    }
  }
}
