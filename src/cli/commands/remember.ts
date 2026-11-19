import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { MEMORY_KINDS, MAX_CONTENT_LENGTH, type MemoryKind } from "../../core/api/contracts.js";
import { createCliContext, type CliContext } from "../context.js";

export interface RememberOptions {
  kind?: string;
  importance?: string;
  tag?: string[];
  expires?: string;
  scope?: string;
  json?: boolean;
}

/** A memory written by hand is deliberate, so it ranks above a routine capture (5). */
export const DEFAULT_REMEMBER_IMPORTANCE = 7;

const DURATION = /^(\d{1,4})([hdw])$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Turn `--expires` into the UTC ISO timestamp the store accepts: a duration (`12h`, `30d`, `2w`)
 * from now, a calendar date (expires at the start of that day, UTC), or a UTC ISO timestamp.
 */
export function parseExpiry(value: string, now: Date = new Date()): string {
  const trimmed = value.trim();
  let at: Date;
  const duration = DURATION.exec(trimmed);
  if (duration) {
    const hours = { h: 1, d: 24, w: 24 * 7 }[duration[2] as "h" | "d" | "w"] * Number(duration[1]);
    at = new Date(now.getTime() + hours * 3_600_000);
  } else if (DATE_ONLY.test(trimmed)) {
    at = new Date(`${trimmed}T00:00:00Z`);
  } else if (UTC_ISO.test(trimmed)) {
    at = new Date(trimmed);
  } else {
    throw new Error(`--expires must be a duration (12h, 30d, 2w), a date (2026-12-31), or a UTC timestamp; got "${value}"`);
  }
  // Date parsing rolls an impossible day over (Feb 31 becomes Mar 3); a typo must not silently
  // move the expiry, so the calendar date has to survive the round trip.
  const calendar = DATE_ONLY.test(trimmed) || UTC_ISO.test(trimmed) ? trimmed.slice(0, 10) : undefined;
  if (Number.isNaN(at.getTime()) || (calendar !== undefined && at.toISOString().slice(0, 10) !== calendar)) {
    throw new Error(`--expires is not a real date: "${value}"`);
  }
  if (at.getTime() <= now.getTime()) throw new Error(`--expires must be in the future: "${value}"`);
  return at.toISOString().replace(/\.000Z$/, "Z");
}

function parseImportance(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REMEMBER_IMPORTANCE;
  const importance = Number(value);
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    throw new Error(`--importance must be a whole number from 1 to 10; got "${value}"`);
  }
  return importance;
}

function parseKind(value: string | undefined): MemoryKind {
  const kind = value ?? "fact";
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`--kind must be one of ${MEMORY_KINDS.join(", ")}; got "${value}"`);
  }
  return kind as MemoryKind;
}

/** The memory text: the words given, or standard input for `-`. */
function readContent(words: string[]): string {
  const text = words.length === 1 && words[0] === "-" ? readFileSync(0, "utf8") : words.join(" ");
  const content = text.replace(/^\uFEFF/, "").trim();
  if (!content) throw new Error("Nothing to remember: give the memory text, or - to read it from stdin");
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`A memory is at most ${MAX_CONTENT_LENGTH} characters; this one is ${content.length}`);
  }
  return content;
}

/** `sessionmem remember <text...>`: store one memory by hand for the current project. */
export async function rememberCommand(
  words: string[],
  options: RememberOptions = {},
  ctx?: CliContext,
): Promise<void> {
  let request;
  try {
    const content = readContent(words);
    request = {
      projectId: "",
      memoryId: randomUUID(),
      // One session per day keeps hand-written memories grouped in the timeline without
      // tripping the per-session write warning meant for agents storing trivia.
      sessionId: `cli-remember-${new Date().toISOString().slice(0, 10)}`,
      sourceAdapter: "cli",
      kind: parseKind(options.kind),
      content,
      importance: parseImportance(options.importance),
      ...(options.tag?.length ? { tags: options.tag } : {}),
      ...(options.expires !== undefined ? { expiresAt: parseExpiry(options.expires) } : {}),
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const context = ctx ?? createCliContext();
  const result = await context.service.call("storeMemory", { ...request, projectId: context.projectId });
  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const memory = result.memory;
  if (options.json) {
    console.log(JSON.stringify({ memory, warningCodes: result.warningCodes }, null, 2));
    return;
  }
  console.log(`Remembered ${memory.id} (${memory.kind}, importance ${memory.importance}).`);
  if (memory.content !== request.content) {
    console.log("Secrets were redacted before saving. Stored text:");
    console.log(`  ${memory.content.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  if (result.warningCodes.includes("redaction_partial_failure")) {
    console.error("Warning: a redaction rule failed on this text; check it with `sessionmem show` before relying on it.");
  }
  console.log(`Undo with: sessionmem forget ${memory.id} --force`);
}
