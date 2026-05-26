import { describe, expect, it } from "vitest";
import { createSessionLifecycleService } from "../../../src/core/api/sessionLifecycleService.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("cloud status warning payload", () => {
  it("adds cloud_summarization_enabled warning when cloud mode is active", async () => {
    const db = openDb();
    const service = createSessionLifecycleService({
      db,
      summarizeCloud: async () => ({
        summary: "cloud summary",
        warningCodes: [],
      }),
    });

    insertSessionEvent(db, {
      id: "evt-1",
      project_id: "project-1",
      session_id: "session-1",
      event_index: 0,
      event_type: "user_message",
      payload_json: "{\"text\":\"one\"}",
      created_at: "2026-05-25T00:00:00.000Z",
    });
    insertSessionEvent(db, {
      id: "evt-2",
      project_id: "project-1",
      session_id: "session-1",
      event_index: 1,
      event_type: "user_message",
      payload_json: "{\"text\":\"two\"}",
      created_at: "2026-05-25T00:00:01.000Z",
    });
    insertSessionEvent(db, {
      id: "evt-3",
      project_id: "project-1",
      session_id: "session-1",
      event_index: 2,
      event_type: "user_message",
      payload_json: "{\"text\":\"three\"}",
      created_at: "2026-05-25T00:00:02.000Z",
    });

    const result = await service.handleSessionEnd({
      projectId: "project-1",
      sessionId: "session-1",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
        summaryTokenCap: 300,
        redactionEnabled: true,
        factMode: "summary+facts",
        allowCloudSummarization: true,
        anthropicApiKey: "key",
      },
    });

    expect(result.warningCodes).toContain("cloud_summarization_enabled");
    expect(result.warningMessages).toContain(
      "Cloud summarization active: allowCloudSummarization=true and ANTHROPIC_API_KEY present",
    );

    db.close();
  });

  it("keeps cloud warnings empty for local-only mode", async () => {
    const db = openDb();
    const service = createSessionLifecycleService({ db });

    insertSessionEvent(db, {
      id: "evt-4",
      project_id: "project-2",
      session_id: "session-2",
      event_index: 0,
      event_type: "user_message",
      payload_json: "{\"text\":\"one\"}",
      created_at: "2026-05-25T00:00:03.000Z",
    });
    insertSessionEvent(db, {
      id: "evt-5",
      project_id: "project-2",
      session_id: "session-2",
      event_index: 1,
      event_type: "user_message",
      payload_json: "{\"text\":\"two\"}",
      created_at: "2026-05-25T00:00:04.000Z",
    });
    insertSessionEvent(db, {
      id: "evt-6",
      project_id: "project-2",
      session_id: "session-2",
      event_index: 2,
      event_type: "user_message",
      payload_json: "{\"text\":\"three\"}",
      created_at: "2026-05-25T00:00:05.000Z",
    });

    const result = await service.handleSessionEnd({
      projectId: "project-2",
      sessionId: "session-2",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
        summaryTokenCap: 300,
        redactionEnabled: true,
        factMode: "summary+facts",
        allowCloudSummarization: false,
      },
    });

    expect(result.usedMode).toBe("local");
    expect(result.warningCodes).not.toContain("cloud_summarization_enabled");
    expect(result.warningMessages).toEqual([]);

    db.close();
  });
});
