import { AdapterFactory } from "../../adapters/factory.js";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { deriveProjectId } from "../projectId.js";
import { resolveDbPath } from "../context.js";

export async function runMcpServer() {
  const adapter = AdapterFactory.detectAdapter();

  // Keep diagnostics beside the selected database so an override never
  // creates the default home directory just to write a log.
  const dbPath = resolveDbPath();
  const logDir = join(dirname(dbPath), "logs");
  const logPath = join(logDir, "mcp.log");

  // Derive project ID for diagnostics. Shares the exact derivation the server
  // uses (createCliContext → deriveProjectId) so the logged id never diverges
  // from the bucket the server actually serves.
  const projectId = deriveProjectId();

  const adapterName = adapter.name;
  const logMessage = `[${new Date().toISOString()}] Started sessionmem | adapter=${adapterName} db=${dbPath} project=${projectId}\n`;

  try {
    if (dbPath !== ":memory:") {
      mkdirSync(logDir, { recursive: true });
      writeFileSync(logPath, logMessage, { flag: "a" });
    }
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

