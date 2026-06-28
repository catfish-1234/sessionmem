import type { RetrievedMemoryCandidate } from "../retrieve/retrieveMemories.js";
import { CRITICAL_WARNING_IMPORTANCE_THRESHOLD } from "../config/policyConfig.js";
import { countTokens, trimLowestPriorityContent } from "./tokenBudget.js";

const DEFAULT_TOKEN_CAP = 450;
const HEADER = "Relevant prior context";
// At most this many preserved (critical-warning) entries may bypass trimming.
// Critical warnings rarely need more, and an unbounded count would let
// preserved entries dominate the injection block past the token cap.
const MAX_PRESERVED = 5;

// Strip control characters and hard-cap per-entry content before it is rendered
// into the injection block. Prevents a single memory from breaking out of the
// block (newlines/control chars) or dominating it (length). The full content
// remains retrievable via retrieveMemories — this only affects startup display.
const safeContent = (content: string) =>
  // eslint-disable-next-line no-control-regex -- intentional control-char strip
  content.replace(/[\n\r\x00-\x08\x0e-\x1f\x7f]/g, " ").slice(0, 500);

// Sanitize source_adapter before it is rendered verbatim onto the metadata
// line. Like `author`, a malformed row could otherwise smuggle newlines/control
// chars (and thus a prompt-injection payload) into the injection block.
const safeSourceAdapter = (s: string | null | undefined) =>
  // eslint-disable-next-line no-control-regex -- intentional control-char strip
  (s ?? "").replace(/[\n\r\x00-\x08\x0e-\x1f\x7f]/g, "").slice(0, 100);
// Allow-list of known kinds. Any unrecognized kind renders as "memory" so a
// malformed row cannot inject arbitrary text into the rendered `[kind]` label.
const KNOWN_KINDS = new Set(["fact", "decision", "preference", "warning", "summary", "memory", "context"]);
function safeKind(kind: string): string {
  return KNOWN_KINDS.has(kind) ? kind : "memory";
}
const KIND_ORDER = ["warning", "decision", "fact", "summary", "preference"] as const;
const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));

export interface FormatStartupInjectionOptions {
  tokenCap?: number;
  localUsername?: string;
}

interface IncludedMemory {
  memory: RetrievedMemoryCandidate;
  content: string;
  priority: number;
  preserve: boolean;
}

function kindRank(kind: string): number {
  return KIND_RANK.get(kind as (typeof KIND_ORDER)[number]) ?? KIND_ORDER.length;
}

function isCriticalWarning(memory: RetrievedMemoryCandidate): boolean {
  return memory.kind === "warning" && memory.importance >= CRITICAL_WARNING_IMPORTANCE_THRESHOLD;
}

function sortMemories(
  memories: RetrievedMemoryCandidate[],
): RetrievedMemoryCandidate[] {
  return [...memories].sort((left, right) => {
    const leftRank = kindRank(left.kind);
    const rightRank = kindRank(right.kind);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (leftRank === KIND_ORDER.length && left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }

    if (right.score.total !== left.score.total) {
      return right.score.total - left.score.total;
    }

    if (right.updated_at !== left.updated_at) {
      return right.updated_at.localeCompare(left.updated_at);
    }

    return left.id.localeCompare(right.id);
  });
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

function authorPrefix(
  memory: RetrievedMemoryCandidate,
  localUsername?: string,
): string {
  if (
    memory.author &&
    localUsername &&
    memory.author !== localUsername
  ) {
    // Defense in depth: even though `author` is constrained at the contract
    // boundary, strip any control characters before rendering so a malformed
    // row cannot break out of the injection block.
    // eslint-disable-next-line no-control-regex -- intentional control-char strip
    const safeAuthor = memory.author.replace(/[\n\r\x00-\x1f\x7f]/g, "");
    return `${safeAuthor}: `;
  }

  return "";
}

function formatLine(entry: IncludedMemory, localUsername?: string): string {
  const { memory } = entry;
  const score = memory.score;
  const prefix = authorPrefix(memory, localUsername);

  return [
    `- [${safeKind(memory.kind)}] ${prefix}${safeContent(entry.content)}`,
    `(score total=${formatScore(score.total)}, semantic=${formatScore(score.raw.semantic)}, recency=${formatScore(score.raw.recency)}, importance=${formatScore(score.raw.importance)}; source=${safeSourceAdapter(memory.source_adapter)}; date=${memory.updated_at})`,
  ].join(" ");
}

function render(entries: IncludedMemory[], localUsername?: string): string {
  if (entries.length === 0) {
    return HEADER;
  }

  return [
    HEADER,
    ...entries.map((entry) => formatLine(entry, localUsername)),
  ].join("\n");
}

function lowestDroppableIndex(entries: IncludedMemory[]): number {
  let index = -1;

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].preserve) {
      continue;
    }

    if (index === -1 || entries[i].priority < entries[index].priority) {
      index = i;
    }
  }

  return index;
}

export function formatStartupInjection(
  rankedMemories: RetrievedMemoryCandidate[],
  options: FormatStartupInjectionOptions = {},
): string {
  const tokenCap = options.tokenCap ?? DEFAULT_TOKEN_CAP;
  const localUsername = options.localUsername;
  // Cap how many entries may be marked `preserve`. Excess critical warnings
  // beyond MAX_PRESERVED become droppable so they cannot bypass the trim/drop
  // loop and blow past the token cap. Sorting first keeps the highest-ranked
  // warnings preserved.
  let preservedCount = 0;
  let included = sortMemories(rankedMemories).map((memory) => {
    let preserve = isCriticalWarning(memory);
    if (preserve) {
      if (preservedCount >= MAX_PRESERVED) {
        preserve = false;
      } else {
        preservedCount += 1;
      }
    }
    return {
      memory,
      content: memory.content,
      priority: KIND_ORDER.length - kindRank(memory.kind),
      preserve,
    };
  });
  let output = render(included, localUsername);

  while (included.length > 0 && countTokens(output) > tokenCap) {
    const trimmed = trimLowestPriorityContent(included);

    if (trimmed.some((entry, index) => entry.content !== included[index].content)) {
      included = trimmed;
      output = render(included, localUsername);
      continue;
    }

    const dropIndex = lowestDroppableIndex(included);
    if (dropIndex === -1) {
      break;
    }

    included = included.filter((_, index) => index !== dropIndex);
    output = render(included, localUsername);
  }

  return output;
}
