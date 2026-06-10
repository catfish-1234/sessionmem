import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { insertMemory } from "../../../src/core/storage/memoryRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

const PROJECT_ID = "project-prune";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedMemory(
  db: ReturnType<typeof openDb>,
  id: string,
  createdAt: string,
): void {
  insertMemory(db, {
    id,
    project_id: PROJECT_ID,
    session_id: "session-1",
    source_adapter: "codex",
    kind: "fact",
    content: `content-${id}`,
    normalized_content: `content ${id}`,
    importance: 5,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

describe("pruneMemories service method", () => {
  it("dry-run counts eligible memories without deleting", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedMemory(db, "stale", isoDaysAgo(200));

    const result = await service.call("pruneMemories", {
      projectId: PROJECT_ID,
      retentionDays: 90,
      dryRun: true,
    });

    expect(result).toMatchObject({ ok: true, eligible: 1, deleted: 0 });

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.some((m) => m.id === "stale")).toBe(true);

    db.close();
  });

  it("apply hard-deletes eligible memories", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedMemory(db, "stale", isoDaysAgo(200));
    seedMemory(db, "fresh", isoDaysAgo(1));

    const result = await service.call("pruneMemories", {
      projectId: PROJECT_ID,
      retentionDays: 90,
      dryRun: false,
    });

    expect(result).toMatchObject({ ok: true, eligible: 1, deleted: 1 });

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.some((m) => m.id === "stale")).toBe(false);
    expect(list.memories.some((m) => m.id === "fresh")).toBe(true);

    db.close();
  });

  it("retentionDays of 0 disables pruning", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedMemory(db, "stale", isoDaysAgo(200));

    const result = await service.call("pruneMemories", {
      projectId: PROJECT_ID,
      retentionDays: 0,
      dryRun: false,
    });

    expect(result).toMatchObject({ ok: true, eligible: 0, deleted: 0 });

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.some((m) => m.id === "stale")).toBe(true);

    db.close();
  });

  it("negative retentionDays disables pruning", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedMemory(db, "stale", isoDaysAgo(200));

    const result = await service.call("pruneMemories", {
      projectId: PROJECT_ID,
      retentionDays: -5,
      dryRun: false,
    });

    expect(result).toMatchObject({ ok: true, eligible: 0, deleted: 0 });

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.some((m) => m.id === "stale")).toBe(true);

    db.close();
  });

  it("returns a validation error envelope for an empty projectId", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.call("pruneMemories", {
      projectId: "",
      retentionDays: 90,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });

    db.close();
  });

  it("dryRun defaults to true when omitted", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seedMemory(db, "stale", isoDaysAgo(200));

    const result = await service.call("pruneMemories", {
      projectId: PROJECT_ID,
      retentionDays: 90,
    });

    expect(result).toMatchObject({ ok: true, eligible: 1, deleted: 0 });

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.some((m) => m.id === "stale")).toBe(true);

    db.close();
  });
});
