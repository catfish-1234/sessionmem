import { AdapterFactory } from "../../adapters/factory.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { deriveProjectId } from "../projectId.js";
import { expandTilde } from "../context.js";

export async function runMcpServer() {
  const adapter = AdapterFactory.detectAdapter();

  // Startup diagnostics: written to ~/.sessionmem/logs/mcp.log
  const logDir = join(homedir(), ".sessionmem", "logs");
  const logPath = join(logDir, "mcp.log");

  // Derive db path for diagnostics (mirrors context.ts defaultDbPath)
  const envDbPath = process.env.SESSIONMEM_DB_PATH;
  const dbPath =
    envDbPath && envDbPath.trim() !== ""
      ? expandTilde(envDbPath)
      : join(homedir(), ".sessionmem", "memories.db");

  // Derive project ID for diagnostics. Shares the exact derivation the server
  // uses (createCliContext → deriveProjectId) so the logged id never diverges
  // from the bucket the server actually serves.
  const projectId = deriveProjectId();

  const adapterName = adapter.name;
  const logMessage = `[${new Date().toISOString()}] Started sessionmem | adapter=${adapterName} db=${dbPath} project=${projectId}\n`;

  try {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logPath, logMessage, { flag: "a" });
  } catch {
    // best-effort logging; ignore failures
  }

  // Debug output to stderr (never stdout — that's the MCP protocol channel)
  if (process.env.SESSIONMEM_DEBUG === "1") {
    process.stderr.write(
      `[sessionmem] db=${dbPath} project=${projectId} adapter=${adapterName}\n`,
    );
  }

  // Start the server
  if (adapter.startMcpServer) {
    await adapter.startMcpServer();
  } else {
    console.error(`Adapter ${adapter.name} does not implement startMcpServer.`);
    process.exit(1);
  }
}

