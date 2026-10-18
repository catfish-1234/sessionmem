import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { expandTilde } from "../context.js";
import { isClaudeRecord, parseClaudeTranscript } from "./claudeCode.js";
import { parseCodexTranscript } from "./codex.js";
import { cursorDatabasePath, cursorUserDirectory, readCursorTranscripts } from "./cursor.js";
import { object, type Transcript, type TranscriptHost, type TranscriptRecord } from "./types.js";

export const TRANSCRIPT_HOSTS: readonly TranscriptHost[] = ["claude-code", "codex", "cursor"];
const parsers = { "claude-code": parseClaudeTranscript, codex: parseCodexTranscript };

export function transcriptDirectory(host: TranscriptHost): string {
  if (host === "cursor") return cursorUserDirectory();
  return join(homedir(), host === "codex" ? ".codex" : ".claude", host === "codex" ? "sessions" : "projects");
}

export interface TranscriptOptions { transcriptsDir?: string; host?: string }

export function transcriptSources(options: TranscriptOptions): { directory: string; host?: TranscriptHost }[] {
  const host = options.host;
  if (host && !TRANSCRIPT_HOSTS.includes(host as TranscriptHost)) {
    throw new Error(`Unsupported transcript host: ${host}. Choose ${TRANSCRIPT_HOSTS.join(" or ")}`);
  }
  const selected = host as TranscriptHost | undefined;
  if (options.transcriptsDir) return [{ directory: resolve(expandTilde(options.transcriptsDir)), host: selected }];
  return (selected ? [selected] : TRANSCRIPT_HOSTS).map(host => ({ directory: transcriptDirectory(host), host }));
}

export async function* transcriptFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* transcriptFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

/** Recognize Cursor overrides without changing JSONL directory overrides. */
export async function isCursorSource(directory: string): Promise<boolean> {
  try {
    if ((await stat(directory)).isFile()) return directory.endsWith(".vscdb");
    return !!await cursorDatabasePath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readTranscript(path: string, claimedHost?: TranscriptHost): Promise<Transcript> {
  if (claimedHost === "cursor") throw new Error("unsupported format for cursor: expected a User directory or state.vscdb database");
  const records: TranscriptRecord[] = [];
  let malformed = false;
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineIndex = 0;
  try {
    for await (const line of lines) {
      const index = lineIndex++;
      if (!line.trim()) continue;
      let value;
      try { value = object(JSON.parse(line.replace(/^\uFEFF/, ""))); }
      catch { malformed = true; continue; }
      if (!value) throw new Error(`unsupported format${claimedHost ? ` for ${claimedHost}` : ""}: record on line ${index + 1} is not an object`);
      records.push({ value, line: index });
    }
  } finally {
    lines.close();
    input.destroy();
  }
  const host = claimedHost ?? (records.some(({ value }) => value.type === "session_meta") ? "codex"
    : records.some(({ value }) => isClaudeRecord(value)) ? "claude-code" : undefined);
  if (!host && records.length) throw new Error("unsupported format: expected Claude Code transcripts or Codex CLI rollouts");
  const result = parsers[host ?? "claude-code"](path, records);
  return { ...result, malformed };
}

/** Read-only doctor probe: enumerate history and validate one sample per host. */
export async function inspectTranscriptDiscovery(host: TranscriptHost): Promise<string> {
  const directory = transcriptDirectory(host);
  if (host === "cursor") {
    const path = await cursorDatabasePath(directory);
    if (!path) return `No transcripts found (${directory})`;
    const transcripts = await readCursorTranscripts(path);
    return `${transcripts.length} composer(s) found (${path}); parsed as cursor`;
  }
  let count = 0;
  let sample: string | undefined;
  for await (const path of transcriptFiles(directory)) { count++; sample ??= path; }
  if (!sample) return `No transcripts found (${directory})`;
  const transcript = await readTranscript(sample, host);
  if (transcript.malformed) throw new Error(`malformed or incomplete JSONL (${sample})`);
  return `${count} transcript file(s) found (${directory}); sample parsed as ${host}`;
}
