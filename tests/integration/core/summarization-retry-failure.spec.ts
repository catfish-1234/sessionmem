import { describe, expect, it } from "vitest";
import { createSessionLifecycleService } from "../../../src/core/api/sessionLifecycleService.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("summarization retry failure behavior", () => {
  it("cloud failure retries 2 times then falls back to local", async () => {
    const db = openDb();
    let cloudAttempts = 0;
    const service = createSessionLifecycleService({
      db,
      summarizeCloud: async () => {
        cloudAttempts += 1;
        throw new Error("cloud down");
      },
      summarizeLocal: async () => ({
        summary: "local fallback summary",
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

    expect(result.status).toBe("stored");
    expect(result.usedMode).toBe("local");
    expect(result.warningCodes).toContain("cloud_fallback_to_local");
    expect(cloudAttempts).toBe(3);

    db.close();
  });

  it("records failure with attempt_count when fallback fails", async () => {
    const db = openDb();
    let failureSeq = 0;
    const service = createSessionLifecycleService({
      db,
      createFailureId: () => `failure-${++failureSeq}`,
      summarizeCloud: async () => {
        throw new Error("cloud down");
      },
      summarizeLocal: async () => {
        throw new Error("local down");
      },
    });

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
        allowCloudSummarization: true,
        anthropicApiKey: "key",
      },
    });

    expect(result.status).toBe("failed");
    expect(result.failureRecordId).toBe("failure-2");

    // Cloud failure recorded first with attempt_count = retries + 1 = 3
    const cloudFailure = db
      .prepare(
        "SELECT attempt_count, reason FROM summarization_failures WHERE id = ? LIMIT 1",
      )
      .get("failure-1") as { attempt_count: number; reason: string };
    expect(cloudFailure.attempt_count).toBe(3);
    expect(cloudFailure.reason).toBe("cloud_failed");

    // Combined failure recorded second with attempt_count = retries + 2 = 4
    const combinedFailure = db
      .prepare(
        "SELECT attempt_count, reason FROM summarization_failures WHERE id = ? LIMIT 1",
      )
      .get("failure-2") as { attempt_count: number; reason: string };
    expect(combinedFailure.attempt_count).toBe(4);
    expect(combinedFailure.reason).toBe("cloud_and_local_failed");

    db.close();
  });
});
