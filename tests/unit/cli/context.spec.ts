import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { createCliContext, expandTilde } from "../../../src/cli/context.js";

const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  homedir: () => testHome.path,
}));

describe("createCliContext", () => {
  let dir: string;
  const contexts: ReturnType<typeof createCliContext>[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sessionmem-context-"));
    testHome.path = join(dir, "missing home");
    vi.stubEnv("SESSIONMEM_DB_PATH", "");
  });
  afterEach(() => {
    for (const ctx of contexts.splice(0)) if (ctx.db.open) ctx.db.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  it("accepts a temp dbPath override and returns the correct shape", () => {
    const dbPath = join(dir, `test-${randomUUID()}.db`);
    const projectId = "test-project";
    const ctx = createCliContext({ dbPath, projectId });
    contexts.push(ctx);

    expect(ctx.dbPath).toBe(dbPath);
    expect(ctx.projectId).toBe(projectId);
    expect(ctx.db).toBeDefined();
    expect(ctx.service).toBeDefined();
  });

  it("derives projectId from process.cwd() basename when not overridden", () => {
    const dbPath = join(dir, `test-${randomUUID()}.db`);
    const ctx = createCliContext({ dbPath });
    contexts.push(ctx);

    // projectId should be the basename of cwd — a non-empty string
    expect(typeof ctx.projectId).toBe("string");
    expect(ctx.projectId.length).toBeGreaterThan(0);
  });

  it("opens the DB and service is functional (store + retrieve round-trip)", async () => {
    const dbPath = join(dir, `test-${randomUUID()}.db`);
    const projectId = "test-project-roundtrip";
    const ctx = createCliContext({ dbPath, projectId });
    contexts.push(ctx);

    const result = await ctx.service.storeMemory({
      memoryId: "mem-ctx-01",
      projectId,
      sessionId: "session-1",
      sourceAdapter: "test",
      kind: "fact",
      content: "context test memory",
      importance: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memory.id).toBe("mem-ctx-01");
    }
  });

  it("accepts an injected db override without opening a new DB file", () => {
    const dbPath = join(dir, `test-${randomUUID()}.db`);
    const ctx1 = createCliContext({ dbPath, projectId: "project-a" });
    contexts.push(ctx1);

    // Inject the already-opened db into a second context
    const ctx2 = createCliContext({ db: ctx1.db, dbPath, projectId: "project-b" });

    expect(ctx2.db).toBe(ctx1.db);
    expect(ctx2.projectId).toBe("project-b");
  });
  it.each(["argument", "environment"])("creates only the selected database parent (%s)", (source) => {
    const dbPath = join(dir, "nested path", "記憶.db");
    if (source === "environment") vi.stubEnv("SESSIONMEM_DB_PATH", dbPath);
    const ctx = createCliContext(source === "argument" ? { dbPath } : {});
    contexts.push(ctx);
    expect(ctx.dbPath).toBe(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(testHome.path)).toBe(false);
  });

  it("creates a missing home for the default database", () => {
    const ctx = createCliContext();
    contexts.push(ctx);
    expect(existsSync(join(testHome.path, ".sessionmem", "memories.db"))).toBe(true);
  });

  it("keeps an in-memory or injected database free of filesystem side effects", () => {
    const ctx = createCliContext({ dbPath: ":memory:" });
    contexts.push(ctx);
    createCliContext({ db: ctx.db, dbPath: join(dir, "unused", "db") });
    expect(existsSync(join(dir, "unused"))).toBe(false);
    expect(existsSync(testHome.path)).toBe(false);
  });

  it("expands quoted tilde paths and leaves drive/UNC paths intact", () => {
    expect(expandTilde("~\\memory.db")).toBe(join(testHome.path, "memory.db"));
    expect(expandTilde("~/memory.db")).toBe(join(testHome.path, "memory.db"));
    for (const path of [String.raw`C:\Users\Ada Lovelace\memory.db`, String.raw`\\server\share\memory.db`]) {
      expect(expandTilde(path)).toBe(path);
    }
  });

});
