import { resolve } from "path";
import { readFileSync } from "fs";
import { listAllMemoryIds } from "../../core/storage/memoryRepo.js";
import { createCliContext, type CliContext } from "../context.js";
import { importMemoryRecordSchema } from "../../core/api/contracts.js";
import type { z } from "zod";

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
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(inPath));
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

  const existingIds = options.merge ? undefined : listAllMemoryIds(context.db);
  const validMemories: Array<z.infer<typeof importMemoryRecordSchema>> = [];
  let skippedCount = 0;
  let invalidCount = 0;

  for (const [index, record] of parsed.entries()) {
    const isRecord = record !== null && typeof record === "object" && !Array.isArray(record);
    if (isRecord && typeof record.id === "string" && existingIds?.has(record.id)) {
      skippedCount += 1;
      continue;
    }
    // Validate unknown values before accessing fields. Keep the source index in
    // diagnostics even when earlier records were duplicates, and preserve the
    // optional provenance fields carried by exports.
    const check = importMemoryRecordSchema.safeParse(
      isRecord ? { ...record, projectId: record.projectId ?? context.projectId } : record,
    );
    if (!check.success) {
      console.error(`Record at index ${index} is invalid, skipping: ${check.error.message}`);
      invalidCount += 1;
      continue;
    }
    validMemories.push(check.data);
  }

  if (validMemories.length === 0) {
    if (invalidCount > 0) {
      console.log(`Imported 0, skipped ${invalidCount} invalid record(s).`);
    } else {
      console.log(`Imported 0, skipped ${skippedCount} duplicates.`);
    }
    return;
  }

  const result = await context.service.call("importMemories", {
    projectId: context.projectId,
    // No explicit redactionEnabled here: the service resolves the effective
    // value from ~/.sessionmem/config.json (override > config > default),
    // so `sessionmem config set redactionEnabled false` governs the
    // import write path too.
    memories: validMemories,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const importedCount = result.imported;
  let suffix =
    result.skippedCrossProject > 0
      ? ` (${result.skippedCrossProject} skipped: id belongs to another project)`
      : "";
  if (result.skippedExisting > 0) {
    suffix += ` (${result.skippedExisting} skipped: id already exists in this project)`;
  }
  if (invalidCount > 0) {
    suffix += ` (${invalidCount} invalid record(s) skipped)`;
  }
  if (options.merge) {
    console.log(`Imported (merged) ${importedCount} memories.${suffix}`);
  } else {
    console.log(
      `Imported ${importedCount}, skipped ${skippedCount} duplicates.${suffix}`,
    );
  }
}
