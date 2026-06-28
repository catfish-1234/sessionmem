import { pingTool } from "../../adapters/tools/ping.js";
import { createCliContext, type CliContext } from "../context.js";

/**
 * `sessionmem ping` — report the local version AND verify the memory store is
 * actually reachable.
 *
 * The previous implementation only echoed the package version and always
 * printed "ok", so a broken/locked database still reported healthy. This opens
 * the DB (running migrations) and executes a trivial query; a failure is
 * surfaced as a non-ok status and a non-zero exit code.
 */
export async function pingCommand(ctx?: CliContext): Promise<void> {
  const versionResult = await pingTool.execute();
  console.log(`version: ${versionResult.version}`);

  let context: CliContext;
  try {
    context = ctx ?? createCliContext();
  } catch (err) {
    console.log("status: error");
    console.log(
      `message: database could not be opened: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("sessionmem ping failed: database unreachable");
    process.exit(1);
  }

  try {
    // Trivial round-trip through the service layer proves migrations ran and
    // the DB answers queries for the current project.
    const result = await context.service.call("stats", {
      projectId: context.projectId,
    });
    if (!result.ok) {
      console.log("status: error");
      console.log(`message: database query failed: ${result.error.message}`);
      console.error("sessionmem ping failed: database query failed");
      process.exit(1);
    }
  } catch (err) {
    console.log("status: error");
    console.log(
      `message: database query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("sessionmem ping failed: database query failed");
    process.exit(1);
  }

  console.log("status: ok");
  console.log("message: sessionmem is operational (database reachable).");
}
