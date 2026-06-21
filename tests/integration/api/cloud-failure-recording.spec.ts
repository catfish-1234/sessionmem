import { describe, expect, it } from "vitest";
import { createSessionLifecycleService } from "../../../src/core/api/sessionLifecycleService.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("cloud failure recording", () => {
  it("records cloud_failed in summarization_failures and falls back to local", async () => {
    const db = openDb();
    const service = createSessionLifecycleService({
      db,
      createFailureId: () => "cloud-fail-record-1",
      summarizeCloud: async () => {
        throw new Error("simulated cloud outage");
      },
      summarizeLocal: async () => ({
        summary: "local fallback summary",
        warningCodes: [],
      }),
    });

    // Insert enough events to trigger summarization
    insertSessionEvent(db, {
      id: "cfr-evt-1",
      project_id: "project-cfr",
      session_id: "session-cfr",
      event_index: 0,
      event_type: "user_message",
      payload_json: '{"text":"hello"}',
      created_at: "2026-06-01T00:00:00.000Z",
    });
    insertSessionEvent(db, {
      id: "cfr-evt-2",
      project_id: "project-cfr",
      session_id: "session-cfr",
      event_index: 1,
      event_type: "assistant_message",
      payload_json: '{"text":"hi"}',
      created_at: "2026-06-01T00:00:01.000Z",
    });
    insertSessionEvent(db, {
      id: "cfr-evt-3",
      project_id: "project-cfr",
      session_id: "session-cfr",
      event_index: 2,
      event_type: "user_message",
      payload_json: '{"text":"goodbye"}',
      created_at: "2026-06-01T00:00:02.000Z",
    });

    const result = await service.handleSessionEnd({
      projectId: "project-cfr",
      sessionId: "session-cfr",
      sourceAdapter: "codex",
      config: {
        autoSummarize: true,
        minimumEventThreshold: 3,
        summaryTokenCap: 300,
        redactionEnabled: true,
        factMode: "summary+facts",
        allowCloudSummarization: true,
        anthropicApiKey: "test-key",
      },
    });

    // 1. Function still returns a valid result using local summarization
    expect(result.ok).toBe(true);
    expect(result.status).toBe("stored");
    expect(result.usedMode).toBe("local");
    expect(result.warningCodes).toContain("cloud_fallback_to_local");

    // 2. Failure IS recorded in summarization_failures table
    const failure = db
      .prepare(
        "SELECT id, project_id, session_id, source_adapter, reason, attempt_count, last_error_json FROM summarization_failures WHERE id = ? LIMIT 1",
      )
      .get("cloud-fail-record-1") as {
      id: string;
      project_id: string;
      session_id: string;
      source_adapter: string;
      reason: string;
      attempt_count: number;
      last_error_json: string;
    };

    expect(failure).toBeDefined();
    expect(failure.project_id).toBe("project-cfr");
    expect(failure.session_id).toBe("session-cfr");
    expect(failure.source_adapter).toBe("codex");

    // 3. Failure record has reason="cloud_failed" and correct attempt_count
    //    CLOUD_RETRY_CONFIG.retries = 2, so attempt_count = retries + 1 = 3
    expect(failure.reason).toBe("cloud_failed");
    expect(failure.attempt_count).toBe(3);

    // Verify last_error_json contains the error message
    const errorData = JSON.parse(failure.last_error_json);
    expect(errorData.message).toBe("simulated cloud outage");

    db.close();
  });
});
