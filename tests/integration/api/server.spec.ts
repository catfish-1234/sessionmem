import type { Database } from "better-sqlite3";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionmemClient, SessionmemApiError } from "sessionmem/client";
import { MAX_BODY_BYTES, MAX_RESPONSE_BYTES, parseApiOptions, startApiServer } from "../../../src/api/server.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";

describe("local single-user API and packaged client", () => {
  let directory: string;
  let db: Database;
  let service: ReturnType<typeof createMemoryCoreService>;
  let api: Awaited<ReturnType<typeof startApiServer>>;
  const now = new Date("2026-01-05T00:00:00.000Z");
  const saved = { memoryId: "new/id + ü", sessionId: "api-session", sourceAdapter: "rest-test",
    kind: "fact" as const, content: "Local REST TypeScript memory", importance: 5, tags: ["api"] };
  const url = (path: string) => new URL(path, api.url);
  const post = (body: unknown) => fetch(url("v1/memories"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  beforeEach(async () => {
    // realpath handles macOS /var versus /private/var; join/tmpdir also work on Windows.
    directory = realpathSync(mkdtempSync(join(tmpdir(), "sessionmem-api-")));
    const policyConfigPath = join(directory, "config.json");
    writeFileSync(policyConfigPath, "{}");
    db = openDb({ dbPath: join(directory, "store.db") });
    service = createMemoryCoreService({ db, policyConfigPath, now: () => now });
    for (const [id, project, content, day] of [
      ["first", "p", "TypeScript first\nline. " + "x".repeat(200), 1],
      ["second", "p", "TypeScript second", 2],
      ["third", "p", "TypeScript third", 3],
      ["elsewhere", "other", "TypeScript other project secret", 2],
    ] as const) {
      insertMemory(db, { id, project_id: project, session_id: id, source_adapter: "test", kind: "fact",
        content, normalized_content: content, importance: 5, tags: '["fixture"]',
        created_at: `2026-01-0${day}T00:00:00.000Z`, updated_at: `2026-01-0${day}T00:00:00.000Z` });
    }
    api = await startApiServer({ service, projectId: "p" }, { port: 0 });
  });

  afterEach(async () => {
    await api?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("defaults to IPv4 loopback with auth off and no CORS or caching", async () => {
    expect(api.server.address()).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    expect(parseApiOptions()).toEqual({ port: 3778, host: "127.0.0.1", token: undefined });
    const response = await fetch(url("v1/memories/first"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).memory.content).toContain("first\nline");
  });

  it("returns the exact compact search, tagged search and timeline service results without writes", async () => {
    const before = db.serialize();
    const search = await fetch(url("v1/search?query=TypeScript&limit=2&tags=fixture&includeHistory=false"));
    expect(await search.json()).toEqual(await service.searchMemoryIndex({
      projectId: "p", query: "TypeScript", limit: 2, tags: ["fixture"], includeHistory: false,
    }));
    const result = await (await fetch(url("v1/search?query=TypeScript&limit=1"))).json();
    expect(result.memories).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(Object.keys(result.memories[0]).sort()).toEqual(["date", "id", "kind", "score", "summary"]);
    expect(result.memories[0].summary.length).toBeLessThanOrEqual(160);
    expect(result.memories[0].summary).not.toMatch(/\n/);
    const timeline = await fetch(url("v1/timeline?memoryId=second&limit=3"));
    expect(await timeline.json()).toEqual(await service.memoryTimeline({ projectId: "p", memoryId: "second", limit: 3, includeHistory: true }));
    const fromDate = "2026-01-01T00:00:00.000Z";
    const toDate = "2026-01-02T00:00:00.000Z";
    const range = await fetch(url(`v1/timeline?fromDate=${fromDate}&toDate=${toDate}`));
    expect(await range.json()).toEqual(await service.memoryTimeline({ projectId: "p", fromDate, toDate, limit: 10, includeHistory: true }));
    expect(db.serialize().equals(before)).toBe(true);
  });

  it("keeps expiry and supersession filtering identical to MCP", async () => {
    for (const [id, content, date, expires] of [
      ["old-editor", "I use VS Code.", "2026-01-01T00:00:00.000Z", null],
      ["new-editor", "I switched to Neovim.", "2026-01-02T00:00:00.000Z", null],
      ["expired", "I use Neovim.", "2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z"],
    ]) insertMemory(db, { id: id!, content: content!, normalized_content: content!, created_at: date!, updated_at: date!,
      expires_at: expires, project_id: "p", session_id: id!, kind: "fact", source_adapter: "test", importance: 5 });
    const client = new SessionmemClient(api.url);
    for (const includeHistory of [false, true]) {
      const input = { query: "VS Code Neovim", limit: 50, includeHistory };
      const result = await client.searchMemoryIndex(input);
      expect(result).toEqual(await service.searchMemoryIndex({ ...input, projectId: "p" }));
      expect(result.memories.map(memory => memory.id)).not.toContain("expired");
      expect(result.memories.some(memory => memory.id === "old-editor")).toBe(includeHistory);
    }
    await expect(client.memoryTimeline({ memoryId: "expired" })).rejects.toMatchObject({ status: 404 });
  });

  it("uses the packaged fetch client for save, search, range/anchor timeline, detail and deletion", async () => {
    const client = new SessionmemClient(api.url);
    const stored = await client.storeMemory(saved);
    expect(stored).toMatchObject({ ok: true, memory: { id: saved.memoryId, projectId: "p", content: saved.content } });
    expect((await client.searchMemoryIndex({ query: "REST", tags: ["api"], limit: 1 })).memories[0].id).toBe(saved.memoryId);
    expect((await client.memoryTimeline({ memoryId: saved.memoryId, limit: 1 })).memories[0].id).toBe(saved.memoryId);
    expect((await client.memoryTimeline({ fromDate: now.toISOString(), toDate: now.toISOString() })).memories[0].id).toBe(saved.memoryId);
    expect(await client.getMemory(saved.memoryId)).toEqual(await service.getMemory({ memoryId: saved.memoryId, projectId: "p" }));
    expect(await client.forgetMemory(saved.memoryId)).toEqual({ ok: true });
    await expect(client.getMemory(saved.memoryId)).rejects.toBeInstanceOf(SessionmemApiError);
    await expect(client.forgetMemory(saved.memoryId)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(db.prepare("SELECT feedback_type FROM memory_feedback WHERE memory_id = ?").get(saved.memoryId)).toEqual({ feedback_type: "manual_delete" });
  });

  it("never crosses projects on search, timeline, detail, save collisions or deletion", async () => {
    const client = new SessionmemClient(api.url);
    expect((await client.searchMemoryIndex({ query: "TypeScript" })).memories.map(memory => memory.id)).not.toContain("elsewhere");
    expect((await client.memoryTimeline({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-05T00:00:00Z" })).memories.map(memory => memory.id)).not.toContain("elsewhere");
    for (const action of [() => client.getMemory("elsewhere"), () => client.forgetMemory("elsewhere"), () => client.memoryTimeline({ memoryId: "elsewhere" })]) {
      await expect(action()).rejects.toMatchObject({ status: 404 });
    }
    await expect(client.storeMemory({ ...saved, memoryId: "elsewhere" })).rejects.toMatchObject({ status: 409 });
    expect((await post({ ...saved, projectId: "other" })).status).toBe(400);
    expect((await fetch(url("v1/search?query=TypeScript&projectId=other"))).status).toBe(400);
    expect((await service.getMemory({ projectId: "other", memoryId: "elsewhere" })).memory.content).toContain("other project secret");
    // A second server can intentionally select another project without leaking the first.
    const other = await startApiServer({ service, projectId: "other" }, { port: 0 });
    try {
      const otherClient = new SessionmemClient(other.url);
      expect((await otherClient.searchMemoryIndex({ query: "TypeScript" })).memories.map(memory => memory.id)).toEqual(["elsewhere"]);
      await expect(otherClient.getMemory("first")).rejects.toMatchObject({ status: 404 });
    } finally { await other.close(); }
  });

  it("requires a configured token on every route and method, and never prints it", async () => {
    await api.close();
    const log = vi.spyOn(console, "log");
    api = await startApiServer({ service, projectId: "p" }, { port: 0, token: "test-token" });
    const before = db.serialize();
    for (const path of ["v1/search?query=TypeScript", "v1/timeline?memoryId=first", "v1/memories/first", "v1/memories", "unknown"]) {
      for (const method of ["GET", "POST", "DELETE", "OPTIONS", "HEAD"]) {
        const response = await fetch(url(path), { method });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe("Bearer");
      }
    }
    expect(db.serialize().equals(before)).toBe(true);
    await expect(new SessionmemClient(api.url, { token: "wrong" }).getMemory("first")).rejects.toMatchObject({ status: 401 });
    expect((await fetch(url("v1/memories/first"), { headers: { Authorization: "bearer test-token" } })).status).toBe(200);
    const client = new SessionmemClient(api.url, { token: "test-token" });
    expect((await client.getMemory("first")).ok).toBe(true);
    expect((await client.searchMemoryIndex({ query: "TypeScript" })).ok).toBe(true);
    expect((await client.memoryTimeline({ memoryId: "first" })).ok).toBe(true);
    expect((await client.storeMemory(saved)).ok).toBe(true);
    expect((await client.forgetMemory(saved.memoryId)).ok).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser reads/writes, null origins, rebinding and absolute URLs with auth on or off", async () => {
    for (const token of [undefined, "secret"]) {
      await api.close();
      api = await startApiServer({ service, projectId: "p" }, { port: 0, token });
      const authorization = token ? { Authorization: `Bearer ${token}` } : {};
      for (const headers of [{ Origin: "https://example.com" }, { Origin: "null" }, { Origin: "" }, { "Sec-Fetch-Site": "cross-site" }]) {
        for (const method of ["GET", "POST", "DELETE", "OPTIONS"]) {
          const response = await fetch(url("v1/memories/first"), { method, headers: { ...authorization, ...headers } });
          expect(response.status, JSON.stringify({ headers, method })).toBe(403);
          expect(response.headers.get("access-control-allow-origin")).toBeNull();
        }
      }
      const response = await fetch(url("v1/memories/first"), { headers: { ...authorization, Origin: new URL(api.url).origin } });
      expect(response.status).toBe(200);
      // Fetch controls Host itself. Use node:http to send an attacker authority.
      const rebound = await new Promise(resolve => {
        const req = request(api.url, { path: "/v1/memories/first", headers: { ...authorization, Host: "example.com" } }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", error => { throw error; });
        req.end();
      });
      expect(rebound).toBe(403);
      const status = await new Promise(resolve => {
        const req = request(api.url, { path: "http://example.com/v1/memories/first", headers: authorization }, res => { res.resume(); resolve(res.statusCode); });
        req.on("error", error => { throw error; });
        req.end();
      });
      expect(status).toBe(403);
    }
  });

  it("rejects invalid inputs, duplicate IDs and wrong methods with bounded errors", async () => {
    for (const path of ["v1/search", "v1/search?query=x&limit=0", "v1/search?query=x&limit=51", "v1/search?query=x&limit=1.5",
      "v1/search?query=x&limit=-1", "v1/search?query=x&includeHistory=yes", "v1/search?query=x&query=y",
      "v1/search?query=" + "x".repeat(1001), "v1/timeline", "v1/timeline?memoryId=first&fromDate=2026-01-01T00:00:00Z",
      "v1/timeline?fromDate=2026-01-02T00:00:00Z&toDate=2026-01-01T00:00:00Z", "v1/timeline?fromDate=bad&toDate=bad",
      "v1/timeline?memoryId=first&limit=51", "v1/memories/%ZZ", "v1/memories/" + "x".repeat(201)]) {
      expect((await fetch(url(path))).status, path).toBe(400);
    }
    expect((await fetch(url("v1/unknown"))).status).toBe(404);
    expect((await post({})).status).toBe(400);
    expect((await post({ ...saved, importance: 11 })).status).toBe(400);
    expect((await post({ ...saved, content: "x".repeat(10001) })).status).toBe(400);
    expect((await post(saved)).status).toBe(201);
    expect((await post(saved)).status).toBe(409);
    for (const [path, method, allow] of [["v1/search", "POST", "GET"], ["v1/timeline", "POST", "GET"],
      ["v1/memories", "GET", "POST"], ["v1/memories/first", "PATCH", "GET, DELETE"]]) {
      const response = await fetch(url(path), { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
    }
  });

  it("bounds declared and chunked request bodies, validates JSON and requires its media type", async () => {
    for (const [body, contentType, expected] of [["{", "application/json", 400], ["", "application/json", 400],
      ["{}", "text/plain", 415], ["x".repeat(MAX_BODY_BYTES + 1), "application/json", 413]] as const) {
      const response = await fetch(url("v1/memories"), { method: "POST", headers: { "Content-Type": contentType }, body });
      expect(response.status).toBe(expected);
    }
    const status = await new Promise(resolve => {
      const req = request(url("v1/memories"), { method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" } }, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on("error", error => { throw error; });
      req.write("x".repeat(MAX_BODY_BYTES));
      req.end("x");
    });
    expect(status).toBe(413);
    expect((await fetch(url("v1/memories"), { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: "{}" })).status).toBe(415);
  });

  it("bounds legacy full-detail responses and hides internal SQL/path errors", async () => {
    db.prepare("UPDATE memories SET content = ? WHERE id = 'first'").run("x".repeat(MAX_RESPONSE_BYTES));
    const oversized = await fetch(url("v1/memories/first"));
    expect(oversized.status).toBe(413);
    expect((await oversized.text()).length).toBeLessThan(200);
    vi.spyOn(service, "getMemory").mockRejectedValue(new Error("SQL error at " + join(directory, "secret.db")));
    const failure = await fetch(url("v1/memories/second"));
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ ok: false, error: { code: "INTERNAL", message: "Unable to access the memory store" } });
  });

  it("refuses remote binds without explicit opt-in and warns when allowed", async () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.2", "::ffff:127.0.0.1"]) {
      await expect(startApiServer({ service, projectId: "p" }, { port: 0, host })).rejects.toThrow("Non-loopback bind refused");
    }
    expect(parseApiOptions({ host: "localhost" }).host).toBe("127.0.0.1");
    expect(parseApiOptions({ host: "::1" }).host).toBe("::1");
    expect(parseApiOptions({ host: "127.0.0.2" }).host).toBe("127.0.0.2");
    expect(() => parseApiOptions({ host: "example.com", allowRemote: true })).toThrow("IP address");
    for (const port of ["-1", "65536", "abc", "1.5"]) expect(() => parseApiOptions({ port })).toThrow("--port");
    for (const token of ["", "a b", "x".repeat(4097)]) expect(() => parseApiOptions({ token })).toThrow("API token");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remote = await startApiServer({ service, projectId: "p" }, { port: 0, host: "0.0.0.0", allowRemote: true });
    try {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
      expect(remote.server.address()).toMatchObject({ address: "0.0.0.0" });
      expect((await new SessionmemClient(remote.url).getMemory("first")).ok).toBe(true);
    } finally { await remote.close(); }
  });
});
