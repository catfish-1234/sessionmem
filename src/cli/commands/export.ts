import { homedir } from "os";
import { join, dirname } from "path";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { createCliContext, type CliContext } from "../context.js";

export async function exportCommand(
  pathArg: string | undefined,
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  const res = await context.service.call("exportMemories", {
    projectId: context.projectId,
  });

  if (!res.ok) {
    console.error(res.error.message);
    process.exit(1);
  }

  // Default to an ISO-dated path; resolve user-supplied path otherwise.
  // Path comes from the local CLI invoker's own argv (same trust level as
  // the process itself), not from a remote/network-facing input, so
  // resolving it to an absolute path is not a path-traversal vector.
  const outPath = pathArg
    ? resolve(pathArg) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    : join(homedir(), ".sessionmem", `export-${new Date().toISOString().slice(0, 10)}.json`);

  // Ensure the target directory exists (the default ~/.sessionmem dir may not
  // have been created yet in this context, e.g. a test-supplied CliContext).
  mkdirSync(dirname(outPath), { recursive: true });

  // Write as a pretty-printed JSON array
  writeFileSync(outPath, JSON.stringify(res.memories, null, 2), "utf8");

  console.log(`Exported ${res.memories.length} memories to ${outPath}`);
}
