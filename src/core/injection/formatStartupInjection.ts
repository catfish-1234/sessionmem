import type { RetrievedMemoryCandidate } from "../retrieve/retrieveMemories.js";
import { countTokens, trimLowestPriorityContent } from "./tokenBudget.js";

const DEFAULT_TOKEN_CAP = 450;
const HEADER = "Relevant prior context";
const KIND_ORDER = ["warning", "decision", "fact", "summary", "preference"] as const;
const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));

export interface FormatStartupInjectionOptions {
  tokenCap?: number;
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
  return memory.kind === "warning" && memory.importance >= 9;
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

function formatLine(entry: IncludedMemory): string {
  const { memory } = entry;
  const score = memory.score;

  return [
    `- [${memory.kind}] ${entry.content}`,
    `(score total=${formatScore(score.total)}, semantic=${formatScore(score.raw.semantic)}, recency=${formatScore(score.raw.recency)}, importance=${formatScore(score.raw.importance)}; source=${memory.source_adapter}; date=${memory.updated_at})`,
  ].join(" ");
}

function render(entries: IncludedMemory[]): string {
  if (entries.length === 0) {
    return HEADER;
  }

  return [HEADER, ...entries.map(formatLine)].join("\n");
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
  let included = sortMemories(rankedMemories).map((memory) => ({
    memory,
    content: memory.content,
    priority: KIND_ORDER.length - kindRank(memory.kind),
    preserve: isCriticalWarning(memory),
  }));
  let output = render(included);

  while (included.length > 0 && countTokens(output) > tokenCap) {
    const trimmed = trimLowestPriorityContent(included);

    if (trimmed.some((entry, index) => entry.content !== included[index].content)) {
      included = trimmed;
      output = render(included);
      continue;
    }

    const dropIndex = lowestDroppableIndex(included);
    if (dropIndex === -1) {
      break;
    }

    included = included.filter((_, index) => index !== dropIndex);
    output = render(included);
  }

  return output;
}
