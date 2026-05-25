import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import {
  ingestSessionEventsRequestSchema,
  retrieveMemoriesRequestSchema,
} from "../../../src/core/api/contracts.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("memory core service contracts", () => {
  it("accepts ingestSessionEvents payload shape", () => {
    const parsed = ingestSessionEventsRequestSchema.parse({
      projectId: "project-1",
      sessionId: "session-1",
      events: [
        {
          id: "evt-1",
          eventIndex: 0,
          eventType: "user_message",
          payloadJson: "{\"text\":\"hello\"}",
        },
      ],
    });

    expect(parsed.events[0].eventType).toBe("user_message");
  });

  it("applies retrieveMemories defaults", () => {
    const parsed = retrieveMemoriesRequestSchema.parse({
      projectId: "project-1",
      query: "hello",
    });

    expect(parsed.limit).toBe(20);
  });

  it("ingestSessionEvents persists events and returns typed response", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const ingestResult = await service.ingestSessionEvents({
      projectId: "project-1",
      sessionId: "session-1",
      events: [
        {
          id: "evt-1",
          eventIndex: 0,
          eventType: "user_message",
          payloadJson: "{\"text\":\"hello\"}",
        },
      ],
    });
    expect(ingestResult.ok).toBe(true);
    expect(ingestResult.ingested).toBe(1);

    const memoryResult = await service.storeMemory({
      memoryId: "mem-1",
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      kind: "fact",
      content: "user prefers short answers",
      importance: 8,
    });
    expect(memoryResult.ok).toBe(true);
    expect(memoryResult.memory.id).toBe("mem-1");

    const retrieved = await service.retrieveMemories({
      projectId: "project-1",
      query: "short answers",
      limit: 5,
    });
    expect(retrieved.ok).toBe(true);
    expect(retrieved.total).toBe(1);
    expect(retrieved.memories[0]?.id).toBe("mem-1");

    const stats = await service.stats({ projectId: "project-1" });
    expect(stats.ok).toBe(true);
    expect(stats.totalMemories).toBe(1);
    expect(stats.totalSessionEvents).toBe(1);

    db.close();
  });
});
