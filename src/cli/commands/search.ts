import { createCliContext, type CliContext } from "../context.js";
import { formatTable } from "../output.js";

export interface SearchOptions {
  // commander supplies option values as strings; the direct test-injection
  // callers pass numbers. Accept both and coerce at the call site.
  limit?: number | string;
  includeHistory?: boolean;
}

const DEFAULT_LIMIT = 10;

function coerceLimit(value: number | string | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`Invalid --limit "${value}": expected an integer from 1 to 100.`);
  }
  return parsed;
}

export async function searchCommand(
  query: string,
  options: SearchOptions = {},
  ctx?: CliContext,
): Promise<void> {
  const limit = coerceLimit(options.limit);
  const context = ctx ?? createCliContext();
  const result = await context.service.call("retrieveMemories", {
    projectId: context.projectId,
    query,
    limit,
    mode: "auto",
    depth: "default",
    includeHistory: options.includeHistory,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  console.log(formatTable(result.memories));
  // Surface the pre-rendered startup-injection block so the
  // `author:` provenance annotation for teammate-authored memories is
  // observable in real `search` output. Already a rendered string; no ANSI
  // color.
  console.log(result.startupInjection);
}
