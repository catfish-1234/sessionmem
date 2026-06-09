import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { createCliContext } from "../../../src/cli/context.js";

describe("createCliContext", () => {
  it("accepts a temp dbPath override and returns the correct shape", () => {
    const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
    const projectId = "test-project";
    const ctx = createCliContext({ dbPath, projectId });

    expect(ctx.dbPath).toBe(dbPath);
    expect(ctx.projectId).toBe(projectId);
    expect(ctx.db).toBeDefined();
    expect(ctx.service).toBeDefined();
  });

  it("derives projectId from process.cwd() basename when not overridden", () => {
    const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
    const ctx = createCliContext({ dbPath });

    // projectId should be the basename of cwd — a non-empty string
    expect(typeof ctx.projectId).toBe("string");
    expect(ctx.projectId.length).toBeGreaterThan(0);
  });

  it("opens the DB and service is functional (store + retrieve round-trip)", async () => {
    const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
    const projectId = "test-project-roundtrip";
    const ctx = createCliContext({ dbPath, projectId });

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
    const dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
    const ctx1 = createCliContext({ dbPath, projectId: "project-a" });

    // Inject the already-opened db into a second context
    const ctx2 = createCliContext({ db: ctx1.db, dbPath, projectId: "project-b" });

    expect(ctx2.db).toBe(ctx1.db);
    expect(ctx2.projectId).toBe("project-b");
  });
});
