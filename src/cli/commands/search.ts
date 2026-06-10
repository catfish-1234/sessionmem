import { createCliContext, type CliContext } from "../context.js";
import { formatTable } from "../output.js";

export interface SearchOptions {
  // commander supplies option values as strings; the direct test-injection
  // callers pass numbers. Accept both and coerce at the call site.
  limit?: number | string;
}

const DEFAULT_LIMIT = 20;

function coerceLimit(value: number | string | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

export async function searchCommand(
  query: string,
  options: SearchOptions = {},
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("retrieveMemories", {
    projectId: context.projectId,
    query,
    limit: coerceLimit(options.limit),
    mode: "auto",
    depth: "default",
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  console.log(formatTable(result.memories));
}
