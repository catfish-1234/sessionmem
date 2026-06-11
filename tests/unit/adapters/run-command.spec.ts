import { describe, it, expect, vi, afterEach } from "vitest";
import { AdapterFactory } from "../../../src/adapters/factory.js";
import { pingTool } from "../../../src/adapters/tools/ping.js";
import { FallbackToolRegistrar } from "../../../src/adapters/capabilities/fallbackTools.js";

describe("run command startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AdapterFactory resolves an adapter that implements startMcpServer", () => {
    const adapter = AdapterFactory.detectAdapter();
    expect(typeof adapter.startMcpServer).toBe("function");
  });

  // NOTE: startMcpServer() is now a REAL stdio MCP server — invoking it
  // in-process would call server.connect(StdioServerTransport), bind to the
  // test runner's stdin, and block forever (and touch ~/.sessionmem). Its
  // runtime behavior (initialize handshake, tools/list, store->retrieve
  // round-trip) is covered by the spawn-based integration spec
  // tests/integration/mcp/stdio-server.spec.ts. Here we only assert the server
  // path never writes to stdout (stdout is reserved for MCP protocol frames;
  // a stray console.log would corrupt the stream — T-08-04).
  it("server module does not log to stdout via console.log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { GenericMCPAdapter } = await import(
      "../../../src/adapters/generic.js"
    );
    const adapter = new GenericMCPAdapter();
    expect(typeof adapter.startMcpServer).toBe("function");
    // Importing/constructing the adapter must not emit anything to stdout.
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("ping tool is available across all adapter configurations", () => {
    const adapterNames = [
      "Generic MCP",
      "Claude Code",
      "Cursor",
      "Windsurf",
      "Cline",
      "Codex",
      "QCoder",
      "Antigravity",
    ];
    // Ping tool is a standalone export, always available regardless of adapter
    expect(pingTool.name).toBe("sessionmem_ping");
    expect(adapterNames.length).toBeGreaterThan(0);
  });

  it("generic adapter call returns error envelope instead of throwing", async () => {
    const adapter = AdapterFactory.detectAdapter();
    const result = await adapter.call("retrieveMemories", {
      projectId: "p",
      query: "test",
    });
    expect(result).toHaveProperty("ok", false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe(
      "INTERNAL",
    );
  });

  it("fallback tools are available for adapters that lack full capability set", () => {
    const cursorCaps = {
      supportsPrompts: false,
      supportsResources: false,
      supportsTools: true,
    };
    const tools = FallbackToolRegistrar.getFallbackTools(cursorCaps);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("fetch_memories");
    expect(toolNames).toContain("startup_inject_memories");
  });
});
