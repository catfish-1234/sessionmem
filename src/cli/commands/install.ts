import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resolveInstallAdapters } from "../../adapters/installedHosts.js";
import type { HostAdapterContract } from "../../adapters/contract/hostAdapterContract.js";
import { injectGuidanceBlock } from "../../adapters/claudeMdInjector.js";
import { createCliContext, resolveDbPath } from "../context.js";
import type { CliContextOverrides } from "../context.js";

export interface InstallOptions {
  /**
   * Force a specific host adapter instead of auto-detecting. Accepts any name
   * in {@link import("../../adapters/factory.js").ADAPTER_NAMES}. Falls back to
   * the SESSIONMEM_ADAPTER env var, then installed-host detection.
   */
  adapter?: string;
}

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
  options?: InstallOptions,
  contextOverrides?: CliContextOverrides,
): Promise<void> {
  // Resolve the target adapter up front so an invalid `--adapter` fails before
  // any filesystem work (DB init, config write).
  let adapters: HostAdapterContract[];
  let forced: boolean;
  try {
    ({ adapters, forced } = resolveInstallAdapters(options));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // Step 1: DB init — run migrations and confirm DB init
  let dbPath: string;
  try {
    const ctx = createCliContext(contextOverrides);
    dbPath = ctx.dbPath;
    if (!contextOverrides?.db) ctx.db.close();
  } catch (err) {
    console.error(
      `✗ DB init failed (${resolveDbPath(contextOverrides?.dbPath)}): ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      "Hint: ensure the database parent directory is writable and run `sessionmem install` again.",
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

  // Try every detected host even when one host's config cannot be updated.
  let failed = false;
  for (const adapter of adapters) {
    console.log(
      forced
        ? `→ Installing for adapter: ${adapter.name} (forced)`
        : `→ Detected host: ${adapter.name} (override with --adapter <name>)`,
    );
    try {
      if (!adapter.install || !(await adapter.install())) {
        throw new Error("config update failed");
      }
      console.log(`✓ ${adapter.name} config updated`);
    } catch (err) {
      console.error(`✗ ${adapter.name} config update failed: ${err instanceof Error ? err.message : String(err)}`);
      printManualFallback(adapter.name);
      failed = true;
      continue;
    }

    const guidanceTargets =
      adapter.guidanceTargets?.() ?? [join(homedir(), ".claude", "CLAUDE.md")];
    for (const target of guidanceTargets) {
      try {
        if (!injectGuidanceBlock(target)) throw new Error("injection failed");
        console.log(`✓ ${adapter.name}: Agent guidance injected (${target})`);
      } catch {
        console.error(`✗ ${adapter.name}: Agent guidance injection failed (non-fatal): ${target}`);
      }
    }
    if (adapter.name === "Claude Code") {
      console.log("✓ Claude Code: SessionStart, SessionEnd, PostToolUse hooks configured (~/.claude/settings.json)");
    }
  }
  if (failed) process.exit(1);
  console.log("✓ sessionmem ready — restart your editor/agent so it picks up the MCP server");
}
