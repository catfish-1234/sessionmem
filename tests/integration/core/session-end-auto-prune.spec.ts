import { describe, expect, it, vi } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

const THREE_EVENTS = [
  {
    id: "evt-1",
    eventIndex: 0,
    eventType: "user_message",
    payloadJson: "{\"text\":\"hello\"}",
  },
  {
    id: "evt-2",
    eventIndex: 1,
    eventType: "assistant_message",
    payloadJson: "{\"text\":\"hi\"}",
  },
  {
    id: "evt-3",
    eventIndex: 2,
    eventType: "decision",
    payloadJson: "{\"text\":\"use local mode\"}",
  },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedOldMemory(
  service: ReturnType<typeof createMemoryCoreService>,
  projectId: string,
  createdAt: string,
): Promise<void> {
  await service.importMemories({
    projectId,
    memories: [
      {
        id: "old-memory-1",
        projectId,
        sessionId: "ancient-session",
        sourceAdapter: "codex",
        kind: "summary",
        content: "an ancient decision that should be pruned",
        importance: 5,
        createdAt,
        updatedAt: createdAt,
      },
    ],
  });
}

describe("session-end auto prune", () => {
  it("hard-deletes memories older than retentionDays at session end while keeping the new summary", async () => {
    const db = openDb();
    const service = createMemoryCoreService({
      db,
      retentionDaysOverride: 90,
    });

    await seedOldMemory(service, "project-1", isoDaysAgo(200));
    await service.ingestSessionEvents({
      projectId: "project-1",
      sessionId: "session-1",
      events: THREE_EVENTS,
    });

    const result = await service.handleSessionEnd({
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      config: { autoSummarize: true, minimumEventThreshold: 3 },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("stored");

    const list = await service.listMemories({ projectId: "project-1" });
    const ids = list.memories.map((m) => m.id);
    expect(ids).not.toContain("old-memory-1");
    expect(ids).toContain("session-1-summary");

    db.close();
  });

  it("skips pruning when retentionDays<=0 (old memory survives)", async () => {
    const db = openDb();
    const service = createMemoryCoreService({
      db,
      retentionDaysOverride: 0,
    });

    await seedOldMemory(service, "project-2", isoDaysAgo(200));
    await service.ingestSessionEvents({
      projectId: "project-2",
      sessionId: "session-2",
      events: THREE_EVENTS,
    });

    const result = await service.handleSessionEnd({
      projectId: "project-2",
      sessionId: "session-2",
      sourceAdapter: "codex",
      config: { autoSummarize: true, minimumEventThreshold: 3 },
    });

    expect(result.status).toBe("stored");

    const list = await service.listMemories({ projectId: "project-2" });
    const ids = list.memories.map((m) => m.id);
    expect(ids).toContain("old-memory-1");

    db.close();
  });

  it("does not alter the summarization outcome regardless of an old memory being present", async () => {
    const dbA = openDb();
    const serviceA = createMemoryCoreService({ db: dbA, retentionDaysOverride: 90 });
    await seedOldMemory(serviceA, "project-3", isoDaysAgo(200));
    await serviceA.ingestSessionEvents({
      projectId: "project-3",
      sessionId: "session-3",
      events: THREE_EVENTS,
    });
    const withOld = await serviceA.handleSessionEnd({
      projectId: "project-3",
      sessionId: "session-3",
      sourceAdapter: "codex",
      config: { autoSummarize: true, minimumEventThreshold: 3 },
    });
    dbA.close();

    const dbB = openDb();
    const serviceB = createMemoryCoreService({ db: dbB, retentionDaysOverride: 90 });
    await serviceB.ingestSessionEvents({
      projectId: "project-3",
      sessionId: "session-3",
      events: THREE_EVENTS,
    });
    const withoutOld = await serviceB.handleSessionEnd({
      projectId: "project-3",
      sessionId: "session-3",
      sourceAdapter: "codex",
      config: { autoSummarize: true, minimumEventThreshold: 3 },
    });
    dbB.close();

    expect(withOld.status).toBe(withoutOld.status);
    expect(withOld.usedMode).toBe(withoutOld.usedMode);
    expect(withOld.memoryId).toBe(withoutOld.memoryId);
  });

  it("swallows a prune failure so summarization still returns ok", async () => {
    const db = openDb();
    const deleteOldMemories = vi.fn(() => {
      throw new Error("prune exploded");
    });
    const service = createMemoryCoreService({
      db,
      retentionDaysOverride: 90,
      deleteOldMemories,
    });

    await seedOldMemory(service, "project-4", isoDaysAgo(200));
    await service.ingestSessionEvents({
      projectId: "project-4",
      sessionId: "session-4",
      events: THREE_EVENTS,
    });

    const result = await service.handleSessionEnd({
      projectId: "project-4",
      sessionId: "session-4",
      sourceAdapter: "codex",
      config: { autoSummarize: true, minimumEventThreshold: 3 },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("stored");
    expect(deleteOldMemories).toHaveBeenCalled();

    db.close();
  });
});
