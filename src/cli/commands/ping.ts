import { pingTool } from "../../adapters/tools/ping.js";

export async function pingCommand(): Promise<void> {
  const result = await pingTool.execute();

  console.log(`status: ${result.status}`);
  console.log(`version: ${result.version}`);
  console.log(`message: ${result.message}`);

  if (result.status !== "ok") {
    console.error(`sessionmem ping failed: ${result.message}`);
    process.exit(1);
  }
  // exit 0 on success (implicit)
}
