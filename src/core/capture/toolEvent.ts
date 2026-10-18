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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
  callId?: string,
): string {
  const full = JSON.stringify({
    tool: toolName,
    text,
    input: shrinkValue(input),
    cwd,
    ...(callId ? { call_id: callId } : {}),
  });
  if (full.length <= MAX_HOOK_PAYLOAD_CHARS) return full;
  return JSON.stringify({ tool: toolName, text, cwd, ...(callId ? { call_id: callId } : {}), truncated: true });
}

export function buildToolEvent(
  toolName: string,
  input: Record<string, unknown> | undefined,
  cwd?: string,
): { eventType: string; payloadJson: string } | undefined {
  if (!CAPTURED_TOOL_TYPES.has(toolName)) return undefined;
  return {
    eventType: `tool_use:${toolName.toLowerCase()}`,
    payloadJson: buildPayloadJson(toolName, describeToolUse(toolName, input), input, cwd),
  };
}

/** Codex function calls retain their native name and call ID. */
export function buildFunctionCallEvent(
  name: string,
  input: Record<string, unknown>,
  callId: string,
  cwd?: string,
): { eventType: string; payloadJson: string } {
  const command = input.command ?? input.cmd;
  const text = ["exec_command", "shell_command", "shell"].includes(name)
    ? describeToolUse("Bash", { command: Array.isArray(command) ? command.join(" ") : command })
    : CAPTURED_TOOL_TYPES.has(name) ? describeToolUse(name, input) : truncate(`Called ${name}`, MAX_TEXT_CHARS);
  return {
    eventType: `tool_use:${name.toLowerCase()}`,
    payloadJson: buildPayloadJson(name, text, input, cwd, callId),
  };
}
