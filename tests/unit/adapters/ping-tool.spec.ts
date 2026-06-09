import { describe, it, expect } from "vitest";
import { pingTool } from "../../../src/adapters/tools/ping.js";

describe("pingTool", () => {
  it("is registered with the correct name", () => {
    expect(pingTool.name).toBe("sessionmem_ping");
  });

  it("has a defined description", () => {
    expect(pingTool.description.length).toBeGreaterThan(0);
  });

  it("returns ok status on execute", async () => {
    const result = await pingTool.execute();
    expect(result.status).toBe("ok");
  });

  it("returns a version string on execute", async () => {
    const result = await pingTool.execute();
    expect(typeof result.version).toBe("string");
    expect(result.version.length).toBeGreaterThan(0);
  });

  it("returns a message indicating operational state", async () => {
    const result = await pingTool.execute();
    expect(result.message).toContain("operational");
  });
});
