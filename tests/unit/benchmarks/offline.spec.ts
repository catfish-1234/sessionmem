import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { blockNetwork } from "../../../benchmarks/lib/offline.mjs";

describe("offline benchmark guard", () => {
  it("blocks network access and records even caught attempts", () => {
    const originalFetch = globalThis.fetch;
    const guard = blockNetwork();
    const socket = new net.Socket();
    try {
      expect(() => fetch("https://example.invalid")).toThrow("blocked network");
      expect(() => http.get("http://example.invalid")).toThrow("blocked network");
      expect(() => socket.connect(80, "example.invalid")).toThrow("blocked network");
      expect(() => dns.lookup("example.invalid", () => {})).toThrow("blocked network");
      expect(() => guard.assertOffline()).toThrow("4 network attempt(s)");
    } finally { socket.destroy(); guard.restore(); }
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
