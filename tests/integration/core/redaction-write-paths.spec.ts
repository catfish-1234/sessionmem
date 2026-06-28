import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

const PROJECT_ID = "project-redaction-write";

function baseStoreRequest(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: "mem-1",
    projectId: PROJECT_ID,
    sessionId: "session-1",
    sourceAdapter: "codex",
    kind: "fact",
    content: "token sk-abcdefghijkl",
    importance: 5,
    ...overrides,
  };
}

describe("storeMemory redaction", () => {
  it("redacts API keys before persisting when redactionEnabled is true", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.storeMemory(
      baseStoreRequest({ redactionEnabled: true }),
    );

    expect(result.ok).toBe(true);
    expect(result.warningCodes).toEqual([]);

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "mem-1",
    });
    expect(fetched.memory.content).toContain("[REDACTED_API_KEY]");
    expect(fetched.memory.content).not.toContain("sk-abcdefghijkl");

    db.close();
  });

  it("stores raw content when redactionEnabled is false", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory(baseStoreRequest({ redactionEnabled: false }));

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "mem-1",
    });
    expect(fetched.memory.content).toContain("sk-abcdefghijkl");
    expect(fetched.memory.content).not.toContain("[REDACTED_API_KEY]");

    db.close();
  });

  it("redacts by default when redactionEnabled is omitted", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory(baseStoreRequest());

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "mem-1",
    });
    expect(fetched.memory.content).toContain("[REDACTED_API_KEY]");
    expect(fetched.memory.content).not.toContain("sk-abcdefghijkl");

    db.close();
  });

  it("includes an empty warningCodes array when no rule fails", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.storeMemory(baseStoreRequest());

    expect(Array.isArray(result.warningCodes)).toBe(true);
    expect(result.warningCodes).toEqual([]);

    db.close();
  });

  it("computes the embedding on redacted text", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory(baseStoreRequest());

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "mem-1",
    });
    // normalizedContent feeds the embedding; it must reflect the redacted text.
    expect(fetched.memory.normalizedContent).not.toContain("sk-abcdefghijkl");

    db.close();
  });

  it("leaves the getMemory response shape unchanged (no warningCodes)", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.storeMemory(baseStoreRequest());
    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "mem-1",
    });

    expect(fetched).not.toHaveProperty("warningCodes");

    db.close();
  });
});

describe("importMemories redaction", () => {
  it("redacts each record's content before upsert when redactionEnabled is true", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.importMemories({
      projectId: PROJECT_ID,
      redactionEnabled: true,
      memories: [
        {
          id: "imp-1",
          projectId: PROJECT_ID,
          sessionId: "session-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "contact user@example.com now",
          importance: 5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    expect(Array.isArray(result.warningCodes)).toBe(true);

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "imp-1",
    });
    expect(fetched.memory.content).toContain("[REDACTED_EMAIL]");
    expect(fetched.memory.content).not.toContain("user@example.com");

    db.close();
  });

  it("stores raw content on import when redactionEnabled is false", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.importMemories({
      projectId: PROJECT_ID,
      redactionEnabled: false,
      memories: [
        {
          id: "imp-2",
          projectId: PROJECT_ID,
          sessionId: "session-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "contact user@example.com now",
          importance: 5,
        },
      ],
    });

    const fetched = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "imp-2",
    });
    expect(fetched.memory.content).toContain("user@example.com");

    db.close();
  });

  it("aggregates warningCodes across records (empty when none fail)", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.importMemories({
      projectId: PROJECT_ID,
      memories: [
        {
          id: "imp-3",
          projectId: PROJECT_ID,
          sessionId: "session-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "plain text",
          importance: 5,
        },
      ],
    });

    expect(result.warningCodes).toEqual([]);

    db.close();
  });

  it("rolls back the whole batch when one record is invalid (atomicity)", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    // Record 1 is valid; record 2 has importance 99 which fails validation.
    // The whole import must be rejected and NO rows from the batch committed.
    const result = await service.call("importMemories", {
      projectId: PROJECT_ID,
      memories: [
        {
          id: "atomic-1",
          projectId: PROJECT_ID,
          sessionId: "session-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "first record",
          importance: 5,
        },
        {
          id: "atomic-2",
          projectId: PROJECT_ID,
          sessionId: "session-1",
          sourceAdapter: "codex",
          kind: "fact",
          content: "second record",
          importance: 99,
        },
      ],
    } as never);

    expect(result.ok).toBe(false);

    const list = await service.listMemories({ projectId: PROJECT_ID });
    expect(list.memories.find((m) => m.id === "atomic-1")).toBeUndefined();
    expect(list.memories.find((m) => m.id === "atomic-2")).toBeUndefined();

    db.close();
  });
});

describe("summarizeSessionToMemory redaction", () => {
  it("redacts secrets in caller-supplied summary", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.summarizeSessionToMemory({
      memoryId: "redact-test",
      projectId: PROJECT_ID,
      sessionId: "session-summary",
      sourceAdapter: "codex",
      summary: "The api key was sk-abcdefghijklmnopqrstuvwx",
      importance: 7,
    });

    expect(result.ok).toBe(true);

    const mem = await service.getMemory({
      projectId: PROJECT_ID,
      memoryId: "redact-test",
    });
    expect(mem.memory.content).not.toContain("sk-abcdef");
    expect(mem.memory.content).toContain("[REDACTED");

    db.close();
  });
});
