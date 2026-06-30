import { createCliContext, type CliContext } from "../context.js";
import { randomUUID } from "node:crypto";

// High-signal tool types that we capture as session events.
const CAPTURED_TOOL_TYPES = new Set(["Bash", "Edit", "Write", "MultiEdit"]);

// Max payload size stored per hook event (chars). The full hook payload can be
// large (file diffs); cap it so a single tool use can't bloat session_events.
const MAX_HOOK_PAYLOAD_CHARS = 4000;

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  session_id?: string;
  cwd?: string;
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
  try {
    const payload = await readStdinJson();
    const toolName = payload.tool_name ?? "";

    if (!CAPTURED_TOOL_TYPES.has(toolName)) return;

    const context = ctx ?? createCliContext();
    const sessionId = resolveSessionId(payload);
    const projectId = context.projectId;

    // Trim payload to cap storage per event.
    const fullPayload = JSON.stringify({
      tool: toolName,
      input: payload.tool_input,
      cwd: payload.cwd,
    });
    const trimmedPayload = fullPayload.length > MAX_HOOK_PAYLOAD_CHARS
      ? fullPayload.slice(0, MAX_HOOK_PAYLOAD_CHARS) + "…"
      : fullPayload;

    // Store as a session event (for SessionEnd auto-summarize).
    await context.service.call("ingestSessionEvents", {
      projectId,
      sessionId,
      events: [{
        id: randomUUID(),
        eventIndex: Date.now(), // monotonic within the session
        eventType: `tool_use:${toolName.toLowerCase()}`,
        payloadJson: trimmedPayload,
      }],
    });

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

    context.db.close();
  } catch {
    // Never block tool use — swallow all errors silently.
  }
}
