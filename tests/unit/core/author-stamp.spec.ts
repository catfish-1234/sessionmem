import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { localUsername } from "../../../src/cli/context.js";

interface TestDb {
  db: Database;
  dbPath: string;
}

const open: TestDb[] = [];

function freshDb(): TestDb {
  const dbPath = join(tmpdir(), `sessionmem-author-${randomUUID()}.db`);
  const db = openDb({ dbPath });
  const handle: TestDb = { db, dbPath };
  open.push(handle);
  return handle;
}

afterEach(() => {
  for (const { db, dbPath } of open.splice(0)) {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {
        // ignore
      }
    }
  }
});

describe("author stamping at write paths (D-07)", () => {
  it("stamps storeMemory rows with the configured username, not ''", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({ db, username: "alice" });

    const result = await service.storeMemory({
      memoryId: "mem-store-1",
      projectId: "proj-a",
      sessionId: "sess-1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Local fact authored by alice.",
      importance: 5,
    });

    expect(result.ok).toBe(true);

    const row = db
      .prepare("SELECT author, origin_project_id FROM memories WHERE id = ?")
      .get("mem-store-1") as { author: string; origin_project_id: string | null };

    expect(row.author).toBe("alice");
    expect(row.author).not.toBe("");
    expect(row.origin_project_id).toBeNull();
  });

  it("importMemories stamps the local username when a record lacks author", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({ db, username: "bob" });

    await service.importMemories({
      projectId: "proj-a",
      memories: [
        {
          id: "mem-import-1",
          projectId: "proj-a",
          sessionId: "sess-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "Imported without author.",
          importance: 4,
        },
      ],
    });

    const row = db
      .prepare("SELECT author FROM memories WHERE id = ?")
      .get("mem-import-1") as { author: string };

    expect(row.author).toBe("bob");
  });

  it("importMemories preserves an incoming author when present", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({ db, username: "bob" });

    await service.importMemories({
      projectId: "proj-a",
      memories: [
        {
          id: "mem-import-2",
          projectId: "proj-a",
          sessionId: "sess-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "Imported with author carol.",
          importance: 4,
          author: "carol",
          originProjectId: "proj-origin",
        },
      ],
    });

    const row = db
      .prepare("SELECT author, origin_project_id FROM memories WHERE id = ?")
      .get("mem-import-2") as { author: string; origin_project_id: string | null };

    expect(row.author).toBe("carol");
    expect(row.origin_project_id).toBe("proj-origin");
  });

  it("getMemory / toMemoryDto expose author on the returned DTO", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({ db, username: "dave" });

    await service.storeMemory({
      memoryId: "mem-dto-1",
      projectId: "proj-a",
      sessionId: "sess-1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "DTO author check.",
      importance: 5,
    });

    const result = await service.getMemory({
      projectId: "proj-a",
      memoryId: "mem-dto-1",
    });

    if (!result.ok) {
      throw new Error("expected getMemory to succeed");
    }

    expect(result.memory.author).toBe("dave");
    expect(result.memory.originProjectId).toBeNull();
  });

  it("localUsername sanitizes a path separator to a filename-safe token", () => {
    const original = process.env.SESSIONMEM_USERNAME;
    process.env.SESSIONMEM_USERNAME = "team/alice";
    try {
      expect(localUsername()).toBe("team_alice");
    } finally {
      if (original === undefined) {
        delete process.env.SESSIONMEM_USERNAME;
      } else {
        process.env.SESSIONMEM_USERNAME = original;
      }
    }
  });
});
