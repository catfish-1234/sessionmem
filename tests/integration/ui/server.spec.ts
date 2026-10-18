import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { listProjectKnowledge } from "../../../src/core/storage/knowledgeRepo.js";
import { listSupersessions } from "../../../src/core/storage/supersessionRepo.js";
import { startUiServer } from "../../../src/ui/server.js";

describe("local read-only viewer", () => {
  let directory: string;
  let db: BetterSqlite3.Database;
  let service: ReturnType<typeof createMemoryCoreService>;
  let viewer: Awaited<ReturnType<typeof startUiServer>>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "sessionmem-ui-"));
    const dbPath = join(directory, "store.db");
    const seed = openDb({ dbPath });
    for (const [id, content, day, project] of [
      ["old", "I use VS Code.", 1, "p"],
      ["middle", "I switched to Neovim.", 2, "p"],
      ["new", "I use Emacs.", 3, "p"],
      ["entity", "Alice uses TypeScript. <script>alert('memory')</script>" + "x".repeat(2500), 4, "p"],
      ["elsewhere", "Bob uses Docker.", 1, "other"],
    ] as const) {
      const date = `2026-01-0${day}T00:00:00.000Z`;
      insertMemory(seed, { id, project_id: project, session_id: id, source_adapter: "test", kind: "fact",
        content, normalized_content: content, importance: 5, created_at: date, updated_at: date });
    }
    seed.close();
    db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    service = createMemoryCoreService({ db, now: () => new Date("2026-01-05T00:00:00.000Z") });
    viewer = await startUiServer({ db, service, projectId: "p" }, 0);
  });

  afterEach(async () => {
    await viewer?.close();
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await fetch(new URL(path, viewer.url));
    expect(response.status).toBe(200);
    return response.json();
  };

  it("binds only to IPv4 loopback on an ephemeral port and serves bundled assets", async () => {
    expect(viewer.server.address()).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    expect(viewer.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
    const page = await fetch(viewer.url);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    const html = await page.text();
    expect(html).toContain("Supersession chains");
    expect(html).not.toContain("<script>alert");
    expect((await fetch(new URL("app.js", viewer.url))).headers.get("content-type")).toContain("text/javascript");
    expect((await fetch(new URL("style.css", viewer.url))).headers.get("content-type")).toContain("text/css");
    const head = await fetch(viewer.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(new URL("/__proto__", viewer.url))).status).toBe(404);
  });

  it("returns projects and paginated memories, with full source details scoped to a project", async () => {
    expect(await get("api/projects")).toEqual({ defaultProjectId: "p", projects: [{ id: "other", count: 1 }, { id: "p", count: 4 }] });
    const page = await get("api/memories?limit=2&offset=1");
    expect(page.total).toBe(4);
    expect(page.memories.map((memory: { id: string }) => memory.id)).toEqual(["new", "middle"]);
    expect(page.memories[0]).toMatchObject({ createdAt: "2026-01-03T00:00:00.000Z" });
    expect((await get("api/memory?id=entity")).memory.content.length).toBeGreaterThan(2000);
    expect((await fetch(new URL("api/memory?id=elsewhere", viewer.url))).status).toBe(404);
    expect((await get("api/memory?project=other&id=elsewhere")).memory.id).toBe("elsewhere");
    expect((await get("api/memories?project=missing")).memories).toEqual([]);
  });

  it("uses public recall in on-demand mode, supports history, and leaves the store byte-identical", async () => {
    const before = db.serialize();
    const call = vi.spyOn(service, "call");
    const result = await get("api/memories?q=VS+Code+Neovim+Emacs");
    expect(call).toHaveBeenCalledWith("retrieveMemories", {
      projectId: "p", query: "VS Code Neovim Emacs", limit: 50, mode: "on-demand", depth: "default", includeHistory: false,
    });
    const expected = await service.retrieveMemories({ projectId: "p", query: "VS Code Neovim Emacs", limit: 50, mode: "on-demand" });
    expect(result.memories).toEqual(expected.memories);
    expect(result.memories.map((memory: { id: string }) => memory.id)).not.toContain("old");
    const historical = await get("api/memories?q=VS+Code+Neovim+Emacs&history=true");
    expect(historical.memories.map((memory: { id: string }) => memory.id)).toContain("old");
    for (const path of ["api/projects", "api/memories", "api/memory?id=old", "api/entities", "api/history"]) await get(path);
    expect(db.serialize().equals(before)).toBe(true);
    expect(db.prepare("SELECT access_count, last_accessed FROM memories").all())
      .toEqual(Array.from({ length: 5 }, () => ({ access_count: 0, last_accessed: null })));
    expect(() => db.prepare("DELETE FROM memories").run()).toThrow(/readonly/);
  });

  it("returns extracted entities, relations and a timestamped multi-step supersession chain", async () => {
    expect(await get("api/entities")).toEqual(listProjectKnowledge(db, "p"));
    expect((await get("api/entities")).relations).toContainEqual(expect.objectContaining({ sourceName: "alice", targetName: "typescript", memoryIds: ["entity"] }));
    const { links } = await get("api/history");
    expect(links).toEqual(listSupersessions(db, "p"));
    expect(links).toMatchObject([
      { supersedes: "old", supersededBy: "middle", oldValue: "vs code", newValue: "neovim", supersededAt: "2026-01-02T00:00:00.000Z", detectedAt: expect.any(String), fullySuperseded: true },
      { supersedes: "middle", supersededBy: "new", supersededAt: "2026-01-03T00:00:00.000Z" },
    ]);
    expect((await get("api/history?project=other")).links).toEqual([]);
  });

  it("rejects every write method without dispatching a service call or changing data", async () => {
    const before = db.serialize();
    const call = vi.spyOn(service, "call");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of ["/", "/api/memories", "/api/memory?id=old", "/api/entities", "/api/history", "/api/forgetMemory"]) {
        const response = await fetch(new URL(path, viewer.url), { method });
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
      }
    }
    expect((await fetch(new URL("api/storeMemory", viewer.url))).status).toBe(404);
    expect(call).not.toHaveBeenCalled();
    expect(db.serialize().equals(before)).toBe(true);
  });

  it("rejects cross-origin requests and unexpected hosts", async () => {
    for (const headers of [{ Origin: "https://example.com" }, { "Sec-Fetch-Site": "cross-site" }]) {
      expect((await fetch(new URL("api/projects", viewer.url), { headers })).status).toBe(403);
    }
    const status = await new Promise(resolve => {
      const req = request(new URL("api/projects", viewer.url), { headers: { Host: "example.com" } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      req.on("error", error => { throw error; });
      req.end();
    });
    expect(status).toBe(403);
  });

  it("returns validation errors for invalid queries and bounds pagination", async () => {
    for (const path of ["api/memories?limit=0", "api/memories?limit=101", "api/memories?offset=-1", "api/memories?limit=NaN", "api/memory", "api/memories?q=" + "x".repeat(1001)]) {
      expect((await fetch(new URL(path, viewer.url))).status, path).toBe(400);
    }
    const head = await fetch(new URL("api/memories", viewer.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});
