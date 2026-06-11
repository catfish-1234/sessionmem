import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDb } from "../../../src/core/storage/db.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";

interface TestDb {
  db: Database;
  dbPath: string;
}

const open: TestDb[] = [];
const tmpFiles: string[] = [];

function freshDb(): TestDb {
  const dbPath = join(tmpdir(), `sessionmem-pull-${randomUUID()}.db`);
  const db = openDb({ dbPath });
  const handle: TestDb = { db, dbPath };
  open.push(handle);
  return handle;
}

/**
 * A temp policy-config file pinning redactionEnabled so the test never depends
 * on (or mutates) the real ~/.sessionmem/config.json.
 */
function policyConfigWith(redactionEnabled: boolean): string {
  const path = join(tmpdir(), `sessionmem-pull-config-${randomUUID()}.json`);
  writeFileSync(
    path,
    JSON.stringify({ retentionDays: 90, redactionEnabled, team: { enabled: false } }),
    "utf8",
  );
  tmpFiles.push(path);
  return path;
}

interface PullRecord {
  id: string;
  projectId: string;
  sessionId: string;
  sourceAdapter: string;
  kind: string;
  content: string;
  importance: number;
  author?: string;
  originProjectId?: string;
  createdAt?: string;
  updatedAt?: string;
}

function record(overrides: Partial<PullRecord> & { id: string }): PullRecord {
  return {
    projectId: "remote-project",
    sessionId: "sess-remote",
    sourceAdapter: "codex",
    kind: "fact",
    content: "A teammate memory.",
    importance: 5,
    ...overrides,
  };
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
  for (const path of tmpFiles.splice(0)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
});

describe("pullMemories merge semantics (TEAM-01)", () => {
  it("LWW overwrites a same-project id and skips a cross-project id (D-09)", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({
      db,
      username: "bob",
      policyConfigPath: policyConfigWith(false),
    });

    // Local row in the pulling user's project.
    await service.storeMemory({
      memoryId: "mem-1",
      projectId: "local",
      sessionId: "s1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Original local content.",
      importance: 5,
    });

    // Another project owns mem-2 — a colliding pull must be skipped.
    await service.storeMemory({
      memoryId: "mem-2",
      projectId: "other-project",
      sessionId: "s2",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Owned by another project.",
      importance: 5,
    });

    const res = await service.pullMemories({
      projectId: "local",
      memories: [
        record({ id: "mem-1", content: "Updated by teammate." }),
        record({ id: "mem-2", projectId: "other-project", content: "Hijack attempt." }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skippedCrossProject).toBe(1);

    const mem1 = db
      .prepare("SELECT content, project_id FROM memories WHERE id = ?")
      .get("mem-1") as { content: string; project_id: string };
    expect(mem1.content).toBe("Updated by teammate.");
    expect(mem1.project_id).toBe("local");

    const mem2 = db
      .prepare("SELECT content, project_id FROM memories WHERE id = ?")
      .get("mem-2") as { content: string; project_id: string };
    // Cross-project row untouched.
    expect(mem2.content).toBe("Owned by another project.");
    expect(mem2.project_id).toBe("other-project");
  });

  it("preserves importance with MAX in both directions (D-11)", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({
      db,
      username: "bob",
      policyConfigPath: policyConfigWith(false),
    });

    // Local importance 8, incoming 3 -> stays 8.
    await service.storeMemory({
      memoryId: "hi",
      projectId: "local",
      sessionId: "s1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "High local importance.",
      importance: 8,
    });
    // Local importance 3, incoming 8 -> becomes 8.
    await service.storeMemory({
      memoryId: "lo",
      projectId: "local",
      sessionId: "s1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Low local importance.",
      importance: 3,
    });

    const res = await service.pullMemories({
      projectId: "local",
      memories: [
        record({ id: "hi", importance: 3, content: "Teammate lowers it." }),
        record({ id: "lo", importance: 8, content: "Teammate raises it." }),
      ],
    });
    expect(res.ok).toBe(true);

    const hi = db
      .prepare("SELECT importance FROM memories WHERE id = ?")
      .get("hi") as { importance: number };
    const lo = db
      .prepare("SELECT importance FROM memories WHERE id = ?")
      .get("lo") as { importance: number };
    expect(hi.importance).toBe(8);
    expect(lo.importance).toBe(8);
  });

  it("re-redacts incoming content on pull regardless of teammate setting (D-12)", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({
      db,
      username: "bob",
      // Config redaction ON; the pull omits an explicit flag so it resolves on.
      policyConfigPath: policyConfigWith(true),
    });

    const res = await service.pullMemories({
      projectId: "local",
      memories: [
        record({
          id: "secret-1",
          content: "Use api key sk-abcdefghijklmnop1234567890 to deploy.",
        }),
      ],
    });
    expect(res.ok).toBe(true);

    const row = db
      .prepare("SELECT content FROM memories WHERE id = ?")
      .get("secret-1") as { content: string };
    expect(row.content).not.toContain("sk-abcdefghijklmnop1234567890");
    expect(row.content).toContain("[REDACTED_API_KEY]");
  });

  it("persists incoming author and origin_project_id (D-06)", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({
      db,
      username: "bob",
      policyConfigPath: policyConfigWith(false),
    });

    await service.pullMemories({
      projectId: "local",
      memories: [
        // Explicit author + originProjectId.
        record({ id: "p1", author: "alice", originProjectId: "alice-proj" }),
        // No originProjectId -> falls back to the record's own projectId.
        record({ id: "p2", author: "carol", projectId: "carol-proj" }),
      ],
    });

    const p1 = db
      .prepare("SELECT author, origin_project_id FROM memories WHERE id = ?")
      .get("p1") as { author: string; origin_project_id: string | null };
    expect(p1.author).toBe("alice");
    expect(p1.origin_project_id).toBe("alice-proj");

    const p2 = db
      .prepare("SELECT author, origin_project_id FROM memories WHERE id = ?")
      .get("p2") as { author: string; origin_project_id: string | null };
    expect(p2.author).toBe("carol");
    expect(p2.origin_project_id).toBe("carol-proj");
  });

  it("distinguishes new inserts from updates for the D-16 summary", async () => {
    const { db } = freshDb();
    const service = createMemoryCoreService({
      db,
      username: "bob",
      policyConfigPath: policyConfigWith(false),
    });

    await service.storeMemory({
      memoryId: "existing",
      projectId: "local",
      sessionId: "s1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "Already here.",
      importance: 5,
    });

    const res = await service.pullMemories({
      projectId: "local",
      memories: [
        record({ id: "existing", content: "Updated." }),
        record({ id: "brand-new-1" }),
        record({ id: "brand-new-2" }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pulledUpdated).toBe(1);
    expect(res.pulledNew).toBe(2);
    expect(res.skippedCrossProject).toBe(0);

    const total = db
      .prepare("SELECT COUNT(*) AS c FROM memories WHERE project_id = ?")
      .get("local") as { c: number };
    expect(total.c).toBe(3);
  });
});
