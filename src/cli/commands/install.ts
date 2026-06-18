import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { AdapterFactory } from "../../adapters/factory.js";
import { injectClaudeMdBlock } from "../../adapters/claudeMdInjector.js";
import { createCliContext } from "../context.js";
import type { CliContextOverrides } from "../context.js";
import {
  configFilePath,
  writePolicyConfig,
  DEFAULT_POLICY_CONFIG,
} from "../../core/config/policyConfig.js";

export const MANUAL_CONFIG_BLOCK = JSON.stringify(
  {
    mcpServers: {
      sessionmem: {
        command: "sessionmem",
        args: ["run"],
      },
    },
  },
  null,
  2,
);

export function printManualFallback(adapterName: string): void {
  console.error(
    `Auto-config for ${adapterName} failed. Add this block to your MCP config manually:`,
  );
  console.log(MANUAL_CONFIG_BLOCK);
}

export async function installCommand(
  _options?: Record<string, unknown>,
  contextOverrides?: CliContextOverrides,
): Promise<void> {
  // Step 1: DB init — run migrations and confirm DB init
  let dbPath: string;
  try {
    const ctx = createCliContext(contextOverrides);
    dbPath = ctx.dbPath;
  } catch (err) {
    console.error(
      `✗ DB init failed (~/.sessionmem/memories.db): ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      "Hint: ensure ~/.sessionmem directory is writable and run `sessionmem install` again.",
    );
    process.exit(1);
  }

  console.log(`✓ DB initialized (${dbPath!})`);

  // Step 1b: Config defaults — write config.json with defaults only when absent.
  // An existing config is preserved byte-for-byte so user settings are
  // never clobbered.
  const configPath = contextOverrides?.configPath ?? configFilePath();
  if (existsSync(configPath)) {
    console.log(`✓ config.json preserved (${configPath})`);
  } else {
    writePolicyConfig(configPath, { ...DEFAULT_POLICY_CONFIG });
    console.log(`✓ config.json initialized (${configPath})`);
  }

  // Step 2: Adapter config — detect adapter and install
  const adapter = AdapterFactory.detectAdapter();

  if (!adapter.install) {
    console.error(`✗ ${adapter.name} config update failed`);
    printManualFallback(adapter.name);
    process.exit(1);
  }

  const success = await adapter.install();
  if (!success) {
    console.error(`✗ ${adapter.name} config update failed`);
    printManualFallback(adapter.name);
    process.exit(1);
  }

  console.log(`✓ ${adapter.name} config updated`);

  // Step 3: CLAUDE.md injection — non-fatal
  const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
  try {
    const injected = injectClaudeMdBlock(claudeMdPath);
    if (injected) {
      console.log(`✓ CLAUDE.md instructions injected (${claudeMdPath})`);
    } else {
      console.error("✗ CLAUDE.md injection failed (non-fatal)");
    }
  } catch {
    console.error("✗ CLAUDE.md injection failed (non-fatal)");
  }

  // Step 4: Full success checklist
  console.log("✓ sessionmem ready");
}
