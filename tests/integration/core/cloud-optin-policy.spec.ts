import { describe, expect, it } from "vitest";
import { createSessionLifecycleService } from "../../../src/core/api/sessionLifecycleService.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

function seedEvents(db: ReturnType<typeof openDb>, projectId: string, sessionId: string): void {
  insertSessionEvent(db, {
    id: `${sessionId}-evt-1`,
    project_id: projectId,
    session_id: sessionId,
    event_index: 0,
    event_type: "user_message",
    payload_json: "{\"text\":\"one\"}",
    created_at: "2026-05-25T00:00:00.000Z",
  });
  insertSessionEvent(db, {
    id: `${sessionId}-evt-2`,
    project_id: projectId,
    session_id: sessionId,
    event_index: 1,
    event_type: "user_message",
    payload_json: "{\"text\":\"two\"}",
    created_at: "2026-05-25T00:00:01.000Z",
  });
  insertSessionEvent(db, {
    id: `${sessionId}-evt-3`,
    project_id: projectId,
    session_id: sessionId,
    event_index: 2,
    event_type: "user_message",
    payload_json: "{\"text\":\"three\"}",
    created_at: "2026-05-25T00:00:02.000Z",
  });
}

describe("cloud opt-in policy", () => {
  it("keeps local mode when allowCloudSummarization=false even with key", async () => {
    const db = openDb();
    seedEvents(db, "project-1", "session-1");
    const service = createSessionLifecycleService({ db });

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
        allowCloudSummarization: false,
        anthropicApiKey: "present-key",
      },
    });

    expect(result.usedMode).toBe("local");
    expect(result.warningCodes).not.toContain("cloud_summarization_enabled");

    db.close();
  });

  it("uses cloud mode with explicit opt-in + key and emits cloud warning", async () => {
    const db = openDb();
    seedEvents(db, "project-2", "session-2");
    const service = createSessionLifecycleService({
      db,
      summarizeCloud: async () => ({
        summary: "cloud summary via mock",
        warningCodes: [],
      }),
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
        allowCloudSummarization: true,
        anthropicApiKey: "present-key",
      },
    });

    expect(result.usedMode).toBe("cloud");
    expect(result.warningCodes).toContain("cloud_summarization_enabled");

    db.close();
  });

  it("falls back to local when cloud fails", async () => {
    const db = openDb();
    seedEvents(db, "project-3", "session-3");
    const service = createSessionLifecycleService({
      db,
      summarizeCloud: async () => {
        throw new Error("cloud fail");
      },
      summarizeLocal: async () => ({
        summary: "fallback",
        warningCodes: [],
      }),
    });

    const result = await service.handleSessionEnd({
      projectId: "project-3",
      sessionId: "session-3",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
        summaryTokenCap: 300,
        redactionEnabled: true,
        factMode: "summary+facts",
        allowCloudSummarization: true,
        anthropicApiKey: "present-key",
      },
    });

    expect(result.usedMode).toBe("local");
    expect(result.warningCodes).toContain("cloud_summarization_enabled");
    expect(result.warningCodes).toContain("cloud_fallback_to_local");
    expect(result.warningMessages.length).toBeGreaterThan(0);

    db.close();
  });
});
