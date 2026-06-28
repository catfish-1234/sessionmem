import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { AdapterFactory } from "../../adapters/factory.js";
import type { HostAdapterContract } from "../../adapters/contract/hostAdapterContract.js";
import { injectGuidanceBlock } from "../../adapters/claudeMdInjector.js";
import { createCliContext } from "../context.js";
import type { CliContextOverrides } from "../context.js";

export interface InstallOptions {
  /**
   * Force a specific host adapter instead of auto-detecting. Accepts any name
   * in {@link import("../../adapters/factory.js").ADAPTER_NAMES}. Falls back to
   * the SESSIONMEM_ADAPTER env var, then auto-detection.
   */
  adapter?: string;
}

/**
 * Resolve the adapter to install into: an explicit `--adapter` flag wins, then
 * the SESSIONMEM_ADAPTER env override, else auto-detection from the host env.
 * Throws (via AdapterFactory.forName) on an unknown explicit name so the CLI
 * surfaces a clear error rather than silently installing the generic adapter.
 */
function resolveAdapter(options?: InstallOptions): {
  adapter: HostAdapterContract;
  forced: boolean;
} {
  const explicit =
    options?.adapter && options.adapter.trim() !== ""
      ? options.adapter.trim()
      : process.env.SESSIONMEM_ADAPTER && process.env.SESSIONMEM_ADAPTER.trim() !== ""
        ? process.env.SESSIONMEM_ADAPTER.trim()
        : undefined;

  if (explicit) {
    return { adapter: AdapterFactory.forName(explicit), forced: true };
  }
  return { adapter: AdapterFactory.detectAdapter(), forced: false };
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
  let adapter: HostAdapterContract;
  let forced: boolean;
  try {
    ({ adapter, forced } = resolveAdapter(options));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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

  // Step 2: Adapter config — install into the resolved adapter. Print which
  // adapter was selected and how, so the user can see whether auto-detection
  // picked the host they expected (and re-run with `--adapter` if not).
  console.log(
    forced
      ? `→ Installing for adapter: ${adapter.name} (forced)`
      : `→ Detected host: ${adapter.name} (override with --adapter <name>)`,
  );

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

  // Step 3: Guidance injection — non-fatal. Inject the sessionmem instruction
  // block into the file(s) the detected host actually reads at session start so
  // the agent automatically knows the MCP exists and how to use it. Adapters
  // declare their own target(s); when none are declared (e.g. a minimal mock or
  // an unknown host) fall back to the global Claude Code memory file.
  const guidanceTargets =
    adapter.guidanceTargets?.() ?? [join(homedir(), ".claude", "CLAUDE.md")];
  for (const target of guidanceTargets) {
    try {
      const injected = injectGuidanceBlock(target);
      if (injected) {
        console.log(`✓ Agent guidance injected (${target})`);
      } else {
        console.error(`✗ Agent guidance injection failed (non-fatal): ${target}`);
      }
    } catch {
      console.error(`✗ Agent guidance injection failed (non-fatal): ${target}`);
    }
  }

  // Step 4: Full success checklist
  if (adapter.name === "Claude Code") {
    console.log(
      "✓ Auto-injection hook installed (~/.claude/settings.json) — prior memories load automatically at the start of every Claude Code session",
    );
  }
  console.log("✓ sessionmem ready — restart your editor/agent so it picks up the MCP server");
}
