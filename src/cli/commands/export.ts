import { homedir } from "os";
import { join } from "path";
import { resolve } from "path";
import { writeFileSync } from "fs";
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

  // D-11: default ISO-dated path; V12: resolve user-supplied path
  const outPath = pathArg
    ? resolve(pathArg)
    : join(homedir(), ".sessionmem", `export-${new Date().toISOString().slice(0, 10)}.json`);

  // D-10: JSON array, pretty-printed
  writeFileSync(outPath, JSON.stringify(res.memories, null, 2), "utf8");

  console.log(`Exported ${res.memories.length} memories to ${outPath}`);
}
