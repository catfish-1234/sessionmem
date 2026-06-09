import { describe, it, expect } from "vitest";
import { FallbackToolRegistrar } from "../../../src/adapters/capabilities/fallbackTools.js";

describe("FallbackToolRegistrar.getFallbackTools", () => {
  it("returns no tools when host has full capabilities", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: true,
      supportsTools: true,
    });
    expect(tools).toHaveLength(0);
  });

  it("registers fetch_memories when host lacks resource support", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    });
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
    });
    expect(tools.find((t) => t.name === "fetch_memories")).toBeUndefined();
  });

  it("registers startup_inject_memories when host lacks prompt support", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: false,
      supportsResources: true,
      supportsTools: true,
    });
    const injectTool = tools.find((t) => t.name === "startup_inject_memories");
    expect(injectTool).toBeDefined();
  });

  it("does not register startup_inject_memories when host supports prompts", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: true,
      supportsTools: true,
    });
    expect(
      tools.find((t) => t.name === "startup_inject_memories"),
    ).toBeUndefined();
  });

  it("registers both fallback tools for minimal host (no resources, no prompts)", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: false,
      supportsResources: false,
      supportsTools: true,
    });
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
    const tools = FallbackToolRegistrar.getFallbackTools(cursorCaps);
    expect(tools).toHaveLength(2);
  });

  it("fetch_memories schema requires query string", () => {
    const tools = FallbackToolRegistrar.getFallbackTools({
      supportsPrompts: true,
      supportsResources: false,
      supportsTools: true,
    });
    const fetchTool = tools.find((t) => t.name === "fetch_memories");
    expect(fetchTool?.schema.properties.query).toEqual({ type: "string" });
  });
});
