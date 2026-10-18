import { buildFunctionCallEvent } from "../../core/capture/toolEvent.js";
import { createdAt, object, stableId, unsupported, type Transcript, type TranscriptRecord } from "./types.js";

/** Remove known host context while preserving human text in the same chunk. */
function humanText(text: string): string {
  if (/^gAAAAA[A-Za-z0-9_=-]+\s*$/.test(text.trim())) return "";
  if (/^\s*# AGENTS\.md instructions for\b/.test(text)
    || /^\s*#{1,3} (?:Skills|Plugins|Plugin catalog(?:ue)?)\s*\n+\s*(?:A skill is|The following (?:skills|plugins)|(?:#{1,3} )?Available (?:skills|plugins))/i.test(text)) return "";
  return text.replace(
    /<(environment_context|plugin_catalogue|plugin_catalog|available_plugins|available_skills|skills_instructions)>[\s\S]*?<\/\1>/gi,
    "",
  ).trim();
}

export function parseCodexTranscript(_path: string, records: TranscriptRecord[]): Transcript {
  const result: Transcript = { host: "codex", sessionId: "", events: [], malformed: false };
  const occurrences = new Map<string, number>();
  for (const { value: record, line } of records) {
    // agent_message envelopes can hold opaque Fernet strings. Never interpret them.
    if (record.type === "agent_message") continue;
    const payload = object(record.payload);
    if (typeof record.timestamp !== "string" || typeof record.type !== "string" || !payload) {
      unsupported(result.host, `invalid rollout envelope on line ${line + 1}`);
    }
    if (record.type === "session_meta") {
      if (typeof payload.id !== "string" || !payload.id.trim()
        || typeof payload.cwd !== "string" || !payload.cwd.trim()) {
        unsupported(result.host, `session_meta needs id and cwd on line ${line + 1}`);
      }
      if (result.sessionId && (result.sessionId !== payload.id || result.cwd !== payload.cwd)) {
        unsupported(result.host, "conflicting session_meta records");
      }
      result.sessionId = payload.id;
      result.cwd = payload.cwd;
    } else if (record.type === "response_item") {
      if (typeof payload.type !== "string") unsupported(result.host, `invalid response_item on line ${line + 1}`);
      if (payload.type === "message") {
        if (typeof payload.role !== "string" || !Array.isArray(payload.content)) {
          unsupported(result.host, `invalid message on line ${line + 1}`);
        }
        if (payload.role !== "user" && payload.role !== "assistant") {
          if (payload.role !== "system" && payload.role !== "developer") {
            unsupported(result.host, `unrecognized message role on line ${line + 1}`);
          }
          continue;
        }
        const chunks: string[] = [];
        for (const raw of payload.content) {
          const chunk = object(raw);
          if (!chunk || typeof chunk.type !== "string") unsupported(result.host, `invalid content on line ${line + 1}`);
          if (chunk.type !== "input_text" && chunk.type !== "output_text") {
            if (!["input_image", "output_image", "image", "input_audio", "audio"].includes(chunk.type)) {
              unsupported(result.host, `unrecognized content type ${chunk.type} on line ${line + 1}`);
            }
            continue;
          }
          if (typeof chunk.text !== "string") unsupported(result.host, `invalid text on line ${line + 1}`);
          const text = payload.role === "user" ? humanText(chunk.text)
            : /^gAAAAA[A-Za-z0-9_=-]+\s*$/.test(chunk.text.trim()) ? "" : chunk.text.trim();
          if (text) chunks.push(text);
        }
        // IDs are absent in some CLI releases. Content plus occurrence preserves
        // repeated turns and survives added metadata and changed replay timestamps.
        const identity = stableId(payload.role, JSON.stringify(chunks));
        const occurrence = occurrences.get(identity) ?? 0;
        if (!chunks.length) continue;
        occurrences.set(identity, occurrence + 1);
        const key = typeof payload.id === "string" ? payload.id
          : typeof record.id === "string" ? record.id : `${identity}-${occurrence}`;
        for (const [index, text] of chunks.entries()) result.events.push({
          id: `message-${key}-${index}`, eventType: `message:${payload.role}`,
          createdAt: createdAt(record.timestamp), payloadJson: JSON.stringify({ text: text.slice(0, 4000) }),
        });
      } else if (payload.type === "function_call") {
        if (typeof payload.name !== "string" || !payload.name.trim()
          || typeof payload.call_id !== "string" || !payload.call_id.trim() || typeof payload.arguments !== "string") {
          unsupported(result.host, `invalid function_call on line ${line + 1}`);
        }
        let input;
        try { input = object(JSON.parse(payload.arguments)); }
        catch { unsupported(result.host, `invalid function_call arguments on line ${line + 1}`); }
        if (!input) unsupported(result.host, `function_call arguments must be an object on line ${line + 1}`);
        result.events.push({
          id: `tool-${payload.call_id}`,
          ...buildFunctionCallEvent(payload.name, input, payload.call_id, result.cwd), createdAt: createdAt(record.timestamp),
        });
      } else if (!["reasoning", "function_call_output", "custom_tool_call", "custom_tool_call_output",
        "web_search_call", "local_shell_call", "compaction", "agent_message"].includes(payload.type)) {
        unsupported(result.host, `unrecognized response_item type ${payload.type} on line ${line + 1}`);
      }
    } else if (!["event_msg", "turn_context", "compacted"].includes(record.type)) {
      unsupported(result.host, `unrecognized record type ${record.type} on line ${line + 1}`);
    }
  }
  if (records.length && !result.sessionId) unsupported(result.host, "missing session_meta record");
  return result;
}
