import { homedir } from "os";
import { join, dirname } from "path";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { createCliContext, type CliContext } from "../context.js";
import { renderMemoriesMarkdown } from "../markdownExport.js";

export interface ExportOptions {
  /** `json` (default, re-importable) or `markdown` (human-readable). Inferred from a `.md` path. */
  format?: string;
  /** Markdown only: leave out memories below this importance. */
  minImportance?: string;
  /** Markdown only: keep memories whose expiry has passed. */
  includeExpired?: boolean;
}

function exportFormat(pathArg: string | undefined, requested: string | undefined): "json" | "markdown" {
  const format = requested?.toLowerCase() ?? (pathArg && /\.(?:md|markdown)$/i.test(pathArg) ? "markdown" : "json");
  if (format === "md" || format === "markdown") return "markdown";
  if (format === "json") return "json";
  throw new Error(`Unknown export format: ${requested}. Use json or markdown.`);
}

function importanceFloor(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:[1-9]|10)$/.test(value)) throw new Error("--min-importance must be an integer from 1 to 10");
  return Number(value);
}

export async function exportCommand(
  pathArg: string | undefined,
  ctx?: CliContext,
  options: ExportOptions = {},
): Promise<void> {
  let format: "json" | "markdown";
  let minImportance: number | undefined;
  try {
    format = exportFormat(pathArg, options.format);
    minImportance = importanceFloor(options.minImportance);
    if (format === "json" && (minImportance !== undefined || options.includeExpired)) {
      throw new Error("--min-importance and --include-expired apply to --format markdown only; the JSON export is always complete");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const context = ctx ?? createCliContext();

  const res = await context.service.call("exportMemories", {
    projectId: context.projectId,
  });

  if (!res.ok) {
    console.error(res.error.message);
    process.exit(1);
  }

  const output = format === "markdown"
    ? renderMemoriesMarkdown(res.memories, {
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      minImportance,
      includeExpired: options.includeExpired,
    })
    : JSON.stringify(res.memories, null, 2);

  // `-` writes to stdout, so the export can be piped or redirected without a temp file.
  if (pathArg === "-") {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    return;
  }

  // Default to an ISO-dated path; resolve user-supplied path otherwise.
  // Path comes from the local CLI invoker's own argv (same trust level as
  // the process itself), not from a remote/network-facing input, so
  // resolving it to an absolute path is not a path-traversal vector.
  const extension = format === "markdown" ? "md" : "json";
  const outPath = pathArg
    ? resolve(pathArg) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    : join(homedir(), ".sessionmem", `export-${new Date().toISOString().slice(0, 10)}.${extension}`);

  // Ensure the target directory exists (the default ~/.sessionmem dir may not
  // have been created yet in this context, e.g. a test-supplied CliContext).
  mkdirSync(dirname(outPath), { recursive: true });

  writeFileSync(outPath, output, "utf8");

  console.log(`Exported ${res.memories.length} memories to ${outPath}`);
}
