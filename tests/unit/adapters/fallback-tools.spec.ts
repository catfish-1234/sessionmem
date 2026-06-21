import { describe, it, expect } from "vitest";
import { FallbackToolRegistrar } from "../../../src/adapters/capabilities/fallbackTools.js";

const mockContext = {
  service: {
    call: async (_method: string, _args: unknown) => ({
      ok: true as const,
      memories: [],
      total: 0,
      startupInjection: "",
    }),
  } as any,
  projectId: "test-project",
};

describe("FallbackToolRegistrar.getFallbackTools", () => {
  it("returns no tools when host has full capabilities", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: true,
      supportsTools: true,
    }, mockContext);
    expect(tools).toHaveLength(0);
  });

  it("registers fetch_memories when host lacks resource support", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    }, mockContext);
    const fetchTool = tools.find((t) => t.name === "fetch_memories");
    expect(fetchTool).toBeDefined();
    expect(fetchTool?.schema.properties).toHaveProperty("query");
    expect(fetchTool?.schema.required).toContain("query");
  });

  it("does not register fetch_memories when host supports resources", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: true,
      supportsTools: true,
    }, mockContext);
    expect(tools.find((t) => t.name === "fetch_memories")).toBeUndefined();
  });

  it("registers startup_inject_memories when host lacks prompt support", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: false,
      supportsResources: true,
      supportsTools: true,
    }, mockContext);
    const injectTool = tools.find((t) => t.name === "startup_inject_memories");
    expect(injectTool).toBeDefined();
  });

  it("does not register startup_inject_memories when host supports prompts", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: true,
      supportsTools: true,
    }, mockContext);
    expect(
      tools.find((t) => t.name === "startup_inject_memories"),
    ).toBeUndefined();
  });

  it("registers both fallback tools for minimal host (no resources, no prompts)", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: false,
      supportsResources: false,
      supportsTools: true,
    }, mockContext);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toContain("fetch_memories");
    expect(tools.map((t) => t.name)).toContain("startup_inject_memories");
  });

  it("Cursor capabilities (no prompts, no resources) triggers both fallback tools", () => {
    const cursorCaps = {
      supportsPrompts: false,
      supportsResources: false,
      supportsTools: true,
    };
    const tools = FallbackToolRegistrar.getFallbackTools(cursorCaps, mockContext);
    expect(tools).toHaveLength(2);
  });

  it("fetch_memories schema requires query string", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    }, mockContext);
    const fetchTool = tools.find((t) => t.name === "fetch_memories");
    expect(fetchTool?.schema.properties.query).toEqual({ type: "string" });
  });

  it("fetch_memories execute calls service and returns JSON string", async () => {
    const mockMemories = [{ id: "m1", content: "test memory" }];
    const contextWithData = {
      service: {
        call: async (_method: string, _args: unknown) => ({
          ok: true as const,
          memories: mockMemories,
          total: 1,
          startupInjection: "",
        }),
      } as any,
      projectId: "test-project",
    };
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    }, contextWithData);
    const fetchTool = tools.find((t) => t.name === "fetch_memories");
    expect(fetchTool).toBeDefined();
    const result = await fetchTool!.execute({ query: "test query" });
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(mockMemories);
  });

  it("fetch_memories execute returns error string on failure", async () => {
    const errorContext = {
      service: {
        call: async (_method: string, _args: unknown) => ({
          ok: false as const,
          error: { code: "INTERNAL", message: "DB unavailable" },
        }),
      } as any,
      projectId: "test-project",
    };
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    }, errorContext);
    const fetchTool = tools.find((t) => t.name === "fetch_memories");
    const result = await fetchTool!.execute({ query: "test" });
    expect(result).toBe("Error: DB unavailable");
  });

  it("startup_inject_memories execute returns startupInjection string", async () => {
    const contextWithInjection = {
      service: {
        call: async (_method: string, _args: unknown) => ({
          ok: true as const,
          memories: [],
          total: 0,
          startupInjection: "Here are your startup memories...",
        }),
      } as any,
      projectId: "test-project",
    };
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: false,
      supportsResources: true,
      supportsTools: true,
    }, contextWithInjection);
    const injectTool = tools.find((t) => t.name === "startup_inject_memories");
    expect(injectTool).toBeDefined();
    const result = await injectTool!.execute();
    expect(result).toBe("Here are your startup memories...");
  });
});
