import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdtempSync, rmSync } from "fs";

/**
 * Integration spec for the REAL stdio MCP server (`sessionmem run`).
 *
 * It spawns the built binary (`node dist/cli/index.js run`), speaks raw
 * newline-delimited JSON-RPC over stdin/stdout (the framing
 * StdioServerTransport uses), and asserts:
 *   1. the MCP `initialize` handshake completes with a well-formed result,
 *   2. `tools/list` advertises at least retrieveMemories + storeMemory,
 *   3. a `storeMemory` then `retrieveMemories` round-trip flows through the
 *      real MemoryCoreService against an isolated temp DB.
 *
 * Isolation: HOME/USERPROFILE point at a mkdtemp dir AND the
 * SESSIONMEM_DB_PATH / SESSIONMEM_PROJECT_ID env seams target a temp DB, so the
 * server never touches the real ~/.sessionmem (Pitfall 3).
 */

const CLI_PATH = join(process.cwd(), "dist", "cli", "index.js");
const PROJECT_ID = "mcp-stdio-test-project";
const STARTUP_TIMEOUT_MS = 15000;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Minimal newline-delimited JSON-RPC client over a spawned process's stdio.
 * Buffers stdout, splits on newlines, and resolves pending requests by id.
 */
class StdioClient {
  private buffer = "";
  private pending = new Map<
    number,
    { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line === "") continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        // Non-JSON line on stdout would indicate protocol corruption; skip.
        continue;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        entry.resolve(msg);
      }
    }
  }

  request(
    method: string,
    params: unknown,
    timeoutMs = STARTUP_TIMEOUT_MS,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(payload + "\n");
    });
  }

  /** Fire-and-forget notification (no id, no response expected). */
  notify(method: string, params: unknown): void {
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }
}

const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "stdio-spec-client", version: "0.0.0" },
};

describe("stdio MCP server (spawned dist/cli/index.js run)", () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let homeDir: string;

  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `Built CLI not found at ${CLI_PATH}. Run "npm run build" before this spec.`,
      );
    }
  });

  function startServer(): StdioClient {
    homeDir = mkdtempSync(join(tmpdir(), "sessionmem-mcp-"));
    const dbPath = join(homeDir, `${randomUUID()}.db`);
    child = spawn(process.execPath, [CLI_PATH, "run"], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        SESSIONMEM_DB_PATH: dbPath,
        SESSIONMEM_PROJECT_ID: PROJECT_ID,
      },
    }) as ChildProcessWithoutNullStreams;
    return new StdioClient(child);
  }

  afterEach(() => {
    if (child && !child.killed) {
      child.kill("SIGKILL");
    }
    child = undefined;
    if (homeDir && existsSync(homeDir)) {
      try {
        rmSync(homeDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  });

  async function handshake(client: StdioClient): Promise<void> {
    const init = await client.request("initialize", INITIALIZE_PARAMS);
    expect(init.error).toBeUndefined();
    const result = init.result as {
      protocolVersion?: string;
      serverInfo?: { name?: string };
      capabilities?: unknown;
    };
    expect(result).toBeTruthy();
    expect(result.protocolVersion).toBeTruthy();
    expect(result.serverInfo?.name).toBe("sessionmem");
    client.notify("notifications/initialized", {});
  }

  it("completes the MCP initialize handshake", async () => {
    const client = startServer();
    await handshake(client);
  });

  it("tools/list advertises retrieveMemories and storeMemory", async () => {
    const client = startServer();
    await handshake(client);

    const listed = await client.request("tools/list", {});
    expect(listed.error).toBeUndefined();
    const tools = (listed.result as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("retrieveMemories");
    expect(names).toContain("storeMemory");
    // ≥6 tools dispatching to the core methods.
    expect(names).toEqual(
      expect.arrayContaining([
        "retrieveMemories",
        "storeMemory",
        "listMemories",
        "getMemory",
        "forgetMemory",
        "stats",
      ]),
    );
  });

  it("round-trips storeMemory -> retrieveMemories through the core service", async () => {
    const client = startServer();
    await handshake(client);

    const stored = await client.request("tools/call", {
      name: "storeMemory",
      arguments: {
        memoryId: "mcp-roundtrip-001",
        sessionId: "mcp-session-1",
        sourceAdapter: "generic",
        kind: "decision",
        content: "Adopt the stdio MCP transport for the sessionmem server.",
        importance: 8,
      },
    });
    expect(stored.error).toBeUndefined();
    const storedResult = stored.result as { isError?: boolean };
    expect(storedResult.isError).not.toBe(true);

    const retrieved = await client.request("tools/call", {
      name: "retrieveMemories",
      arguments: { query: "stdio MCP transport", limit: 5 },
    });
    expect(retrieved.error).toBeUndefined();
    const retrievedResult = retrieved.result as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    expect(retrievedResult.isError).not.toBe(true);
    const text = retrievedResult.content.map((c) => c.text).join("\n");
    expect(text).toContain("stdio MCP transport");
  });
});
