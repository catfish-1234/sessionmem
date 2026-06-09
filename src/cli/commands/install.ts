import { AdapterFactory } from "../../adapters/factory.js";

const MANUAL_CONFIG_BLOCK = JSON.stringify(
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

function printManualFallback(adapterName: string): void {
  console.error(
    `Auto-config for ${adapterName} failed. Add this block to your MCP config manually:`,
  );
  console.log(MANUAL_CONFIG_BLOCK);
}

export async function installCommand(): Promise<void> {
  const adapter = AdapterFactory.detectAdapter();

  if (!adapter.install) {
    printManualFallback(adapter.name);
    return;
  }

  const success = await adapter.install();
  if (!success) {
    printManualFallback(adapter.name);
  } else {
    console.log(`sessionmem installed for ${adapter.name}.`);
  }
}
