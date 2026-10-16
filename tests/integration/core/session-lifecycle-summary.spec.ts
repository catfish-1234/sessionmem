import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { countTokens } from "../../../src/core/injection/tokenBudget.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("session lifecycle summary pipeline", () => {
  it("session_end triggers summarize when event count >= threshold", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.ingestSessionEvents({
      projectId: "project-1",
      sessionId: "session-1",
      events: [
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
      ],
    });

    const result = await service.handleSessionEnd({
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("stored");
    expect(result.usedMode).toBe("local");
    expect(result.memoryId).toBe("session-1-summary");

    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM memories WHERE project_id = ? AND session_id = ? AND kind = 'summary'",
      )
      .get("project-1", "session-1") as { count: number };
    expect(row.count).toBe(1);

    const second = await service.handleSessionEnd({
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
      },
    });
    expect(second.status).toBe("stored");

    const rowAfterSecond = db
      .prepare(
        "SELECT COUNT(*) AS count FROM memories WHERE project_id = ? AND session_id = ? AND kind = 'summary'",
      )
      .get("project-1", "session-1") as { count: number };
    expect(rowAfterSecond.count).toBe(1);

    db.close();
  });

  it("session_end returns skipped_threshold when events are below minimum", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.ingestSessionEvents({
      projectId: "project-2",
      sessionId: "session-2",
      events: [
        {
          id: "evt-1",
          eventIndex: 0,
          eventType: "user_message",
          payloadJson: "{\"text\":\"hello\"}",
        },
      ],
    });

    const result = await service.handleSessionEnd({
      projectId: "project-2",
      sessionId: "session-2",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("skipped_threshold");
    expect(result.usedMode).toBe("local");

    db.close();
  });
  it("summarizes a large session in bounded output across ingestion batches", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    try {
      for (let batch = 0; batch < 3; batch++) {
        const result = await service.ingestSessionEvents({
          projectId: "large-project", sessionId: "large-session",
          events: Array.from({ length: 400 }, (_, i) => ({
            id: `large-${batch}-${i}`, eventType: "tool_use",
            payloadJson: JSON.stringify({ text: `Step ${batch * 400 + i}: 決定 café\r\n` + "context ".repeat(500) }),
          })),
        });
        expect(result.ingested).toBe(400);
      }
      const result = await service.handleSessionEnd({
        projectId: "large-project", sessionId: "large-session", sourceAdapter: "test",
        config: { autoSummarize: true, minimumEventThreshold: 3, summaryTokenCap: 300 },
      });
      expect(result.status).toBe("stored");
      const row = db.prepare("SELECT content FROM memories WHERE id = 'large-session-summary'").get() as { content: string };
      expect(row.content.length).toBeGreaterThan(0);
      expect(countTokens(row.content)).toBeLessThanOrEqual(300);
      expect(db.prepare("SELECT COUNT(*) AS count FROM session_events").get()).toEqual({ count: 1200 });
    } finally { db.close(); }
  });

});
