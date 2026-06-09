import { AdapterFactory } from "../../adapters/factory.js";
import { createCliContext } from "../context.js";
import type { CliContextOverrides } from "../context.js";

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
  // Step 1: DB init — run migrations and confirm DB init (D-04 item 1)
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

  // Step 2: Adapter config — detect adapter and install (D-04 item 2)
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

  // Step 3: Full success checklist (D-05)
  console.log("✓ sessionmem ready");
}
