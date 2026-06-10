import { AdapterFactory } from "../../adapters/factory.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function runMcpServer() {
  const adapter = AdapterFactory.detectAdapter();

  // Setup rudimentary log for debugging manual configs
  const logDir = join(homedir(), ".sessionmem", "logs");
  const logPath = join(logDir, "mcp.log");
  const logMessage = `[${new Date().toISOString()}] Started sessionmem via ${adapter.name}\n`;

  try {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logPath, logMessage, { flag: "a" });
  } catch {
    // best-effort logging; ignore failures
  }

  // Start the server
  if (adapter.startMcpServer) {
    await adapter.startMcpServer();
  } else {
    console.error(`Adapter ${adapter.name} does not implement startMcpServer.`);
    process.exit(1);
  }
}

