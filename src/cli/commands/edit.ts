import { createCliContext, type CliContext } from "../context.js";
import { parseExpiry, parseImportance, parseKind, readContent } from "./remember.js";

export interface EditOptions {
  kind?: string;
  importance?: string;
  tag?: string[];
  clearTags?: boolean;
  expires?: string;
  json?: boolean;
}

const preview = (text: string): string => text.replace(/\s+/g, " ").slice(0, 200);

/**
 * `sessionmem edit <id> [text...]`: correct a memory in place. Only what is given changes; the
 * memory keeps its id, history links and access counts. The text it replaced is printed, so an
 * edit made by mistake can be put back with a second edit.
 */
export async function editCommand(
  id: string,
  words: string[],
  options: EditOptions = {},
  ctx?: CliContext,
): Promise<void> {
  let changes: Record<string, unknown>;
  try {
    if (options.tag?.length && options.clearTags) throw new Error("Use --tag or --clear-tags, not both");
    changes = {
      ...(words.length ? { content: readContent(words) } : {}),
      ...(options.kind !== undefined ? { kind: parseKind(options.kind) } : {}),
      ...(options.importance !== undefined ? { importance: parseImportance(options.importance) } : {}),
      ...(options.tag?.length ? { tags: options.tag } : {}),
      ...(options.clearTags ? { tags: null } : {}),
      ...(options.expires !== undefined
        ? { expiresAt: options.expires.trim().toLowerCase() === "never" ? null : parseExpiry(options.expires) }
        : {}),
    };
    if (Object.keys(changes).length === 0) {
      throw new Error("Nothing to change: give new text, or --kind, --importance, --tag, --clear-tags or --expires");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const context = ctx ?? createCliContext();
  const before = await context.service.call("getMemory", { projectId: context.projectId, memoryId: id });
  if (!before.ok) {
    console.error(before.error.message);
    process.exit(1);
  }
  const result = await context.service.call("updateMemory", { ...changes, projectId: context.projectId, memoryId: id });
  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const memory = result.memory;
  if (options.json) {
    console.log(JSON.stringify({ memory, previous: before.memory, warningCodes: result.warningCodes }, null, 2));
    return;
  }
  console.log(`Updated ${memory.id} (${memory.kind}, importance ${memory.importance}).`);
  if (changes.content !== undefined) {
    if (memory.content !== changes.content) {
      console.log("Secrets were redacted before saving. Stored text:");
      console.log(`  ${preview(memory.content)}`);
    }
    console.log("It replaced:");
    console.log(`  ${preview(before.memory.content)}`);
  }
  if (result.warningCodes.includes("redaction_partial_failure")) {
    console.error("Warning: a redaction rule failed on this text; check it with `sessionmem show` before relying on it.");
  }
}
