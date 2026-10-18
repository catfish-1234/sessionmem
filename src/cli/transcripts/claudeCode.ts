import { basename } from "node:path";
import { buildToolEvent } from "../../core/capture/toolEvent.js";
import { createdAt, object, unsupported, type Transcript, type TranscriptRecord } from "./types.js";

const METADATA_TYPES = new Set([
  "file-history-snapshot", "queue-operation", "summary", "system", "progress",
  "last-prompt", "pr-link", "custom-title", "agent-name", "agent-color",
]);

export function isClaudeRecord(record: Record<string, unknown>): boolean {
  return ((record.type === "user" || record.type === "assistant") && !!object(record.message))
    || METADATA_TYPES.has(String(record.type));
}

export function parseClaudeTranscript(path: string, records: TranscriptRecord[]): Transcript {
  const result: Transcript = { host: "claude-code", sessionId: basename(path, ".jsonl"), events: [], malformed: false };
  for (const { value: record, line } of records) {
    if (!isClaudeRecord(record)) unsupported(result.host, `unrecognized record on line ${line + 1}`);
    if (!result.cwd && typeof record.cwd === "string" && record.cwd.trim()) result.cwd = record.cwd;
    // Claude subagent files reuse the parent's session ID.
    if (!basename(path).startsWith("agent-") && typeof record.sessionId === "string") {
      result.sessionId = record.sessionId;
    }
    if (record.type !== "user" && record.type !== "assistant") continue;
    const content = object(record.message)?.content;
    if (typeof content !== "string" && !Array.isArray(content)) {
      unsupported(result.host, `invalid message content on line ${line + 1}`);
    }
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
    for (const [blockIndex, rawBlock] of blocks.entries()) {
      const block = object(rawBlock);
      if (!block) unsupported(result.host, `invalid message block on line ${line + 1}`);
      const key = typeof record.uuid === "string" ? record.uuid : `line-${line}`;
      const timestamp = createdAt(record.timestamp);
      if (block.type === "tool_use") {
        if (typeof block.name !== "string") unsupported(result.host, `invalid tool use on line ${line + 1}`);
        const event = buildToolEvent(block.name, object(block.input), result.cwd);
        if (event) result.events.push({
          id: typeof block.id === "string" ? `tool-${block.id}` : `${key}-${blockIndex}`,
          ...event, createdAt: timestamp,
        });
      } else if (block.type === "text") {
        if (typeof block.text !== "string") unsupported(result.host, `invalid text on line ${line + 1}`);
        if (block.text.trim()) result.events.push({
          id: `${key}-${blockIndex}`, eventType: `message:${record.type}`, createdAt: timestamp,
          payloadJson: JSON.stringify({ text: block.text.slice(0, 4000) }),
        });
      } else if (!["tool_result", "image", "document", "thinking", "redacted_thinking",
        "server_tool_use", "web_search_tool_result", "web_fetch_tool_result"].includes(String(block.type))) {
        unsupported(result.host, `unrecognized message block on line ${line + 1}`);
      }
    }
  }
  return result;
}
