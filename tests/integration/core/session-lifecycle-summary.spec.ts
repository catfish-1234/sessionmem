import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
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
});
