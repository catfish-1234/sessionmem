import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { AdapterFactory } from "../../adapters/factory.js";
import { removeClaudeMdBlock } from "../../adapters/claudeMdInjector.js";

export interface UninstallOptions {
  purge?: boolean;
  /** Override dbPath for testing purposes */
  dbPath?: string;
}

export async function uninstallCommand(options: UninstallOptions = {}): Promise<void> {
  const adapter = AdapterFactory.detectAdapter();

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

  // CLAUDE.md cleanup — non-fatal
  const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
  try {
    removeClaudeMdBlock(claudeMdPath);
    console.log("✓ CLAUDE.md instructions removed");
  } catch {
    console.error("✗ CLAUDE.md cleanup failed (non-fatal)");
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
