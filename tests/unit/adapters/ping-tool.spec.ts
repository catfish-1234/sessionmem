import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { pingTool } from "../../../src/adapters/tools/ping.js";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json") as { version: string };

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

  it("returns a version string matching package.json", async () => {
    const result = await pingTool.execute();
    expect(typeof result.version).toBe("string");
    expect(result.version.length).toBeGreaterThan(0);
    expect(result.version).toBe(pkg.version);
  });

  it("returns a message indicating operational state", async () => {
    const result = await pingTool.execute();
    expect(result.message).toContain("operational");
  });
});
