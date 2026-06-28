import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { AdapterFactory } from "../../adapters/factory.js";
import type { HostAdapterContract } from "../../adapters/contract/hostAdapterContract.js";
import { removeClaudeMdBlock } from "../../adapters/claudeMdInjector.js";

export interface UninstallOptions {
  purge?: boolean;
  /**
   * Force a specific host adapter instead of auto-detecting. Mirrors the
   * install command's `--adapter` flag so a force-installed adapter can be
   * cleanly uninstalled. Falls back to SESSIONMEM_ADAPTER, then auto-detection.
   */
  adapter?: string;
  /** Override dbPath for testing purposes */
  dbPath?: string;
}

/**
 * Resolve the adapter to uninstall from: an explicit `--adapter` flag wins,
 * then the SESSIONMEM_ADAPTER env override, else auto-detection. Throws (via
 * AdapterFactory.forName) on an unknown explicit name.
 */
function resolveUninstallAdapter(options: UninstallOptions) {
  const explicit =
    options.adapter && options.adapter.trim() !== ""
      ? options.adapter.trim()
      : process.env.SESSIONMEM_ADAPTER && process.env.SESSIONMEM_ADAPTER.trim() !== ""
        ? process.env.SESSIONMEM_ADAPTER.trim()
        : undefined;

  return explicit
    ? AdapterFactory.forName(explicit)
    : AdapterFactory.detectAdapter();
}

export async function uninstallCommand(options: UninstallOptions = {}): Promise<void> {
  let adapter: HostAdapterContract;
  try {
    adapter = resolveUninstallAdapter(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!adapter.uninstall) {
    console.error(
      `${adapter.name} does not support automated uninstall. Remove sessionmem from your MCP config manually.`,
    );
    process.exit(1);
  }

  const success = await adapter.uninstall();
  if (!success) {
    console.error(`✗ ${adapter.name} config removal failed`);
    process.exit(1);
  }

  console.log(`✓ ${adapter.name} config removed`);

  // Guidance cleanup — non-fatal. Remove the sessionmem block from every file
  // the adapter injected it into at install time. Falls back to the global
  // Claude Code memory file when the adapter declares no targets.
  const guidanceTargets =
    adapter.guidanceTargets?.() ?? [join(homedir(), ".claude", "CLAUDE.md")];
  for (const target of guidanceTargets) {
    try {
      removeClaudeMdBlock(target);
      console.log(`✓ Agent guidance removed (${target})`);
    } catch {
      console.error(`✗ Agent guidance cleanup failed (non-fatal): ${target}`);
    }
  }

  // Resolve dbPath: use injected override (for tests) or the default location
  const dbPath = options.dbPath ?? join(homedir(), ".sessionmem", "memories.db");

  if (options.purge) {
    // --purge: delete only memories.db, not logs or the ~/.sessionmem directory
    if (existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
    }
    console.log("✓ memories.db deleted");
  } else {
    // Default: preserve memories.db
    console.log(`Memory DB preserved at ${dbPath}`);
  }
}
