import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("o200k_base");

const DEFAULT_MIN_CONTENT_TOKENS = 12;
const DEFAULT_TRIM_RATIO = 0.75;

export interface TokenBudgetEntry {
  content: string;
  priority: number;
  preserve?: boolean;
}

export interface TrimLowestPriorityContentOptions {
  minContentTokens?: number;
  trimRatio?: number;
}

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export function capTokens(text: string, cap: number): string {
  const tokens = encoding.encode(text);
  if (tokens.length <= cap) {
    return text;
  }
  // Reserve room for the truncation marker, then verify the re-encoded text:
  // token boundaries can change when a decoded prefix and suffix are joined.
  const suffix = " ...";
  for (let keep = Math.max(0, Math.floor(cap) - countTokens(suffix)); keep >= 0; keep--) {
    const trimmed = encoding.decode(tokens.slice(0, keep)).trimEnd();
    const result = trimmed ? `${trimmed}${suffix}` : suffix.trim();
    if (countTokens(result) <= cap) return result;
  }
  return "";
}

export function trimLowestPriorityContent<T extends TokenBudgetEntry>(
  included: T[],
  options: TrimLowestPriorityContentOptions = {},
): T[] {
  const minContentTokens = options.minContentTokens ?? DEFAULT_MIN_CONTENT_TOKENS;
  const trimRatio = options.trimRatio ?? DEFAULT_TRIM_RATIO;
  const ordered = [...included].sort((left, right) => {
    if (left.preserve !== right.preserve) {
      return left.preserve ? 1 : -1;
    }

    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return countTokens(right.content) - countTokens(left.content);
  });

  const target = ordered.find((entry) => {
    return !entry.preserve && countTokens(entry.content) > minContentTokens;
  });

  if (!target) {
    return included;
  }

  return included.map((entry) => {
    if (entry !== target) {
      return entry;
    }

    const tokens = encoding.encode(entry.content);
    const keepCount = Math.max(
      minContentTokens,
      Math.floor(tokens.length * trimRatio),
    );
    const trimmed = encoding.decode(tokens.slice(0, keepCount)).trimEnd();

    return {
      ...entry,
      content: `${trimmed}...`,
    };
  });
}
