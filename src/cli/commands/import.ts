import { resolve } from "path";
import { readFileSync } from "fs";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";
import { createCliContext, type CliContext } from "../context.js";
import { importMemoryRecordSchema } from "../../core/api/contracts.js";

export async function importCommand(
  pathArg: string,
  options: { merge?: boolean },
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  // V12: resolve user-supplied path.
  // Path comes from the local CLI invoker's own argv (same trust level as
  // the process itself), not from a remote/network-facing input, so
  // resolving it to an absolute path is not a path-traversal vector.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const inPath = resolve(pathArg);

  // Read and parse the JSON file
  let parsed: unknown;
  try {
    const raw = readFileSync(inPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read or parse import file: ${message}`);
    process.exit(1);
  }

  // Must be an array
  if (!Array.isArray(parsed)) {
    console.error("Import file must be a JSON array of memory records.");
    process.exit(1);
  }

  const records = parsed as Array<Record<string, unknown>>;

  let toImport = records;
  let skippedCount = 0;

  if (!options.merge) {
    // D-12 default: skip existing IDs (pre-filter)
    const existingRows = listMemoriesByProject(context.db, context.projectId);
    const existingIds = new Set(existingRows.map((r) => r.id));

    const filtered = records.filter((r) => {
      const id = typeof r.id === "string" ? r.id : undefined;
      return id === undefined || !existingIds.has(id);
    });
    skippedCount = records.length - filtered.length;
    toImport = filtered;
  }

  if (toImport.length === 0 && skippedCount > 0) {
    console.log(`Imported 0, skipped ${skippedCount} duplicates.`);
    return;
  }

  // Map to the expected shape, then validate each record before sending to the service
  const mapped = toImport.map((r) => ({
    id: r.id as string,
    projectId: (r.projectId as string) ?? context.projectId,
    sessionId: r.sessionId as string,
    sourceAdapter: r.sourceAdapter as string,
    kind: r.kind as string,
    content: r.content as string,
    importance: r.importance as number,
    createdAt: r.createdAt as string | undefined,
    updatedAt: r.updatedAt as string | undefined,
  }));

  for (let i = 0; i < mapped.length; i++) {
    const check = importMemoryRecordSchema.safeParse(mapped[i]);
    if (!check.success) {
      console.error(`Record at index ${i} is invalid: ${check.error.message}`);
      process.exit(1);
    }
  }

  const result = await context.service.call("importMemories", {
    projectId: context.projectId,
    // No explicit redactionEnabled here: the service resolves the effective
    // value from ~/.sessionmem/config.json (override > config > default,
    // D-11), so `sessionmem config set redactionEnabled false` governs the
    // import write path too (CR-01).
    memories: mapped,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const importedCount = result.imported;
  if (options.merge) {
    console.log(`Imported (merged) ${importedCount} memories.`);
  } else {
    console.log(`Imported ${importedCount}, skipped ${skippedCount} duplicates.`);
  }
}
