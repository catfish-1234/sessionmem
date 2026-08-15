import { createCliContext, type CliContext } from "../context.js";
import { randomUUID } from "node:crypto";

// High-signal tool types that we capture as session events.
const CAPTURED_TOOL_TYPES = new Set(["Bash", "Edit", "Write", "MultiEdit"]);

// Max payload size stored per hook event (chars). The full hook payload can be
// large (file diffs); cap it so a single tool use can't bloat session_events.
const MAX_HOOK_PAYLOAD_CHARS = 4000;

// Per-field cap applied BEFORE serialization. Truncating the serialized JSON
// instead would produce a string that is no longer valid JSON, which the
// `payloadJson` contract rejects (it parses the value) — the event would then be
// dropped, silently, by the catch-all below. Trim the inputs, not the output.
const MAX_FIELD_CHARS = 1200;

// One-line human summary shown in session summaries (summaryShape reads `text`).
const MAX_TEXT_CHARS = 300;

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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
 * Shorten every string in a tool input to MAX_FIELD_CHARS, recursively. Keeps
 * the object's shape (so it still serializes to valid JSON) while bounding the
 * size contributed by large fields such as a Write tool's `content` or an Edit
 * tool's replacement text.
 */
function shrinkValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncate(value, MAX_FIELD_CHARS);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => shrinkValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shrinkValue(inner, depth + 1);
    }
    return out;
  }
  // Numbers/booleans/null pass through; functions/undefined/symbols drop out.
  return value === undefined || typeof value === "function" || typeof value === "symbol"
    ? undefined
    : value;
}

/**
 * A short human-readable line describing the tool use. Stored alongside the
 * structured input as `text`, which the local summarizer prefers over the raw
 * payload — so session summaries read as prose instead of dumped JSON.
 */
function describeToolUse(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  const str = (key: string): string =>
    typeof input?.[key] === "string" ? (input[key] as string) : "";

  if (toolName === "Bash") {
    const command = str("command").replace(/\s+/g, " ").trim();
    return truncate(command ? `Ran: ${command}` : "Ran a shell command", MAX_TEXT_CHARS);
  }

  const filePath = str("file_path") || str("path") || str("notebook_path");
  const verb = toolName === "Write" ? "Wrote" : "Edited";
  return truncate(
    filePath ? `${verb} ${filePath}` : `${verb} a file`,
    MAX_TEXT_CHARS,
  );
}

/**
 * Serialize the event payload, guaranteeing valid JSON within
 * MAX_HOOK_PAYLOAD_CHARS. Per-field shrinking handles the common case; if the
 * result is still over budget (many fields, or one huge key set), drop the
 * structured input and keep only the human-readable summary rather than
 * emitting truncated — and therefore unparseable — JSON.
 */
function buildPayloadJson(
  toolName: string,
  text: string,
  input: Record<string, unknown> | undefined,
  cwd: string | undefined,
): string {
  const full = JSON.stringify({
    tool: toolName,
    text,
    input: shrinkValue(input),
    cwd,
  });
  if (full.length <= MAX_HOOK_PAYLOAD_CHARS) return full;
  return JSON.stringify({ tool: toolName, text, cwd, truncated: true });
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

    if (!CAPTURED_TOOL_TYPES.has(toolName)) {
      debug(`skipped: tool "${toolName}" is not captured`);
      return;
    }

    context = ctx ?? createCliContext();
    const sessionId = resolveSessionId(payload);
    const projectId = context.projectId;
    const text = describeToolUse(toolName, payload.tool_input);

    // eventIndex is intentionally omitted: the service assigns the next free
    // index per session inside an immediate transaction, so parallel tool calls
    // cannot collide (see nextSessionEventIndex).
    const result = await context.service.call("ingestSessionEvents", {
      projectId,
      sessionId,
      events: [{
        id: randomUUID(),
        eventType: `tool_use:${toolName.toLowerCase()}`,
        payloadJson: buildPayloadJson(
          toolName,
          text,
          payload.tool_input,
          payload.cwd,
        ),
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
