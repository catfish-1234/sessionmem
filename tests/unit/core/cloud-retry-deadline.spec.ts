import { describe, expect, it } from "vitest";
import {
  CLOUD_DEADLINE_MS,
  createSessionLifecycleService,
  isRetryableCloudError,
} from "../../../src/core/api/sessionLifecycleService.js";
import { CLOUD_REQUEST_TIMEOUT_MS } from "../../../src/core/summarize/cloudSummarizer.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

// The cloud step runs inside the SessionEnd hook, which the host stops after a minute by default.
// It must give up early enough for the local fallback to still store a summary.

function serviceWith(summarizeCloud: () => Promise<never>, clock: { now: number }) {
  const db = openDb();
  for (let i = 0; i < 3; i++) {
    insertSessionEvent(db, {
      id: `evt-${i}`, project_id: "p", session_id: "s", event_index: i, event_type: "user_message",
      payload_json: JSON.stringify({ text: `message ${i}` }), created_at: `2026-11-20T00:00:0${i}.000Z`,
    });
  }
  return createSessionLifecycleService({
    db,
    now: () => new Date(clock.now),
    summarizeCloud,
    summarizeLocal: async () => ({ summary: "local fallback summary", warningCodes: [] }),
  });
}

const request = {
  projectId: "p", sessionId: "s", sourceAdapter: "claude-code",
  config: { autoSummarize: true, allowCloudSummarization: true, anthropicApiKey: "k", summarizerMode: "cloud" as const },
};

describe("cloud summarization deadline", () => {
  it("leaves room for the local fallback inside a one-minute hook", () => {
    expect(CLOUD_DEADLINE_MS).toBeLessThanOrEqual(45_000);
    expect(CLOUD_REQUEST_TIMEOUT_MS).toBeLessThan(CLOUD_DEADLINE_MS);
  });

  it("stops retrying once another attempt could run past the deadline", async () => {
    const clock = { now: Date.parse("2026-11-20T00:00:00Z") };
    let attempts = 0;
    const service = serviceWith(async () => {
      attempts += 1;
      clock.now += CLOUD_REQUEST_TIMEOUT_MS; // each attempt times out
      throw new Error("Request timed out.");
    }, clock);
    const result = await service.handleSessionEnd(request as never);
    expect(attempts).toBe(1);
    expect(result).toMatchObject({ ok: true, status: "stored", usedMode: "local" });
  });

  it("does not retry an error that will fail the same way again", async () => {
    const clock = { now: Date.parse("2026-11-20T00:00:00Z") };
    let attempts = 0;
    const service = serviceWith(async () => {
      attempts += 1;
      throw Object.assign(new Error("invalid x-api-key"), { status: 401 });
    }, clock);
    const result = await service.handleSessionEnd(request as never);
    expect(attempts).toBe(1);
    expect(result).toMatchObject({ ok: true, usedMode: "local" });
  });

  it("classifies errors by whether another attempt could succeed", () => {
    for (const status of [408, 409, 429, 500, 529]) {
      expect(isRetryableCloudError(Object.assign(new Error("x"), { status }))).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 413]) {
      expect(isRetryableCloudError(Object.assign(new Error("x"), { status }))).toBe(false);
    }
    expect(isRetryableCloudError(new Error("Connection error."))).toBe(true);
    expect(isRetryableCloudError(new Error("Cloud summarizer declined the request"))).toBe(false);
    expect(isRetryableCloudError(new Error("Missing anthropicApiKey"))).toBe(false);
  });
});
