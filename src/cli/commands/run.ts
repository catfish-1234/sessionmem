import { AdapterFactory } from "../../adapters/factory.js";
import { writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function runMcpServer() {
  const adapter = AdapterFactory.detectAdapter();
  
  // Setup rudimentary log for debugging manual configs
  const logPath = join(homedir(), ".sessionmem", "logs", "mcp.log");
  const logMessage = `[${new Date().toISOString()}] Started sessionmem via ${adapter.name}\n`;
  
  try {
    writeFileSync(logPath, logMessage, { flag: "a" });
  } catch (err) {
    // Ignore if log dir doesn't exist yet
  }

  // Start the server
  if (adapter.startMcpServer) {
    await adapter.startMcpServer();
  } else {
    console.error(`Adapter ${adapter.name} does not implement startMcpServer.`);
    process.exit(1);
  }
}

// Simple execution block for the CLI entry point
if (process.argv[2] === "run") {
  runMcpServer().catch((err) => {
    console.error("Fatal error running MCP server:", err);
    process.exit(1);
  });
}
