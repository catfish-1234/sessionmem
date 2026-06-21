import { describe, expect, it, vi } from "vitest";
import { openDb } from "../../../src/core/storage/db.js";
import { insertMemory, listMemoriesByProject } from "../../../src/core/storage/memoryRepo.js";
import { searchMemoryCandidates } from "../../../src/core/storage/memorySearchRepo.js";
import {
  insertSessionEvent,
  listSessionEventsBySession,
} from "../../../src/core/storage/sessionEventsRepo.js";
import {
  countDistinctSessions,
  listEventPayloads,
} from "../../../src/core/storage/tokenSavingsRepo.js";
import { insertMemoryFeedbackEvent } from "../../../src/core/storage/memoryFeedbackRepo.js";
import {
  insertSummarizationFailure,
  listSummarizationFailures,
} from "../../../src/core/storage/summarizationFailuresRepo.js";

function makeMemoryInput(id: string) {
  return {
    id,
    project_id: "proj-1",
    session_id: "sess-1",
    source_adapter: "test",
    kind: "fact",
    content: "test content",
    normalized_content: "test content",
    importance: 5,
  };
}

describe("WeakMap statement caching", () => {
  it("does not recompile statements on repeated calls to the same db (memoryRepo)", () => {
    const db = openDb();
    const prepareSpy = vi.spyOn(db, "prepare");

    // First call — statements are compiled
    insertMemory(db, makeMemoryInput("m-1"));
    const firstCallCount = prepareSpy.mock.calls.length;

    // Second call — statements should be cached
    insertMemory(db, makeMemoryInput("m-2"));
    const secondCallCount = prepareSpy.mock.calls.length;

    // No additional prepare() calls on the second invocation
    expect(secondCallCount).toBe(firstCallCount);

    // Also verify the data was actually inserted correctly
    const memories = listMemoriesByProject(db, "proj-1");
    expect(memories).toHaveLength(2);

    db.close();
  });

  it("does not recompile statements on repeated calls (memorySearchRepo)", () => {
    const db = openDb();
    insertMemory(db, makeMemoryInput("m-search-1"));

    const prepareSpy = vi.spyOn(db, "prepare");

    searchMemoryCandidates(db, "proj-1");
    const firstCallCount = prepareSpy.mock.calls.length;

    searchMemoryCandidates(db, "proj-1");
    const secondCallCount = prepareSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);
    db.close();
  });

  it("does not recompile statements on repeated calls (sessionEventsRepo)", () => {
    const db = openDb();

    const prepareSpy = vi.spyOn(db, "prepare");

    insertSessionEvent(db, {
      id: "evt-1",
      project_id: "proj-1",
      session_id: "sess-1",
      event_index: 0,
      event_type: "start",
      payload_json: "{}",
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const firstCallCount = prepareSpy.mock.calls.length;

    insertSessionEvent(db, {
      id: "evt-2",
      project_id: "proj-1",
      session_id: "sess-1",
      event_index: 1,
      event_type: "end",
      payload_json: "{}",
      created_at: "2025-01-01T00:00:01.000Z",
    });
    const secondCallCount = prepareSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);

    const events = listSessionEventsBySession(db, "proj-1", "sess-1");
    expect(events).toHaveLength(2);

    db.close();
  });

  it("does not recompile statements on repeated calls (tokenSavingsRepo)", () => {
    const db = openDb();

    // Seed a session event so there's data to query
    insertSessionEvent(db, {
      id: "evt-ts-1",
      project_id: "proj-1",
      session_id: "sess-1",
      event_index: 0,
      event_type: "start",
      payload_json: '{"tokens": 100}',
      created_at: "2025-01-01T00:00:00.000Z",
    });

    const prepareSpy = vi.spyOn(db, "prepare");

    countDistinctSessions(db, "proj-1");
    const firstCallCount = prepareSpy.mock.calls.length;

    countDistinctSessions(db, "proj-1");
    const secondCallCount = prepareSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);

    listEventPayloads(db, "proj-1");
    // No additional compiles beyond the initial cache-fill for tokenSavingsRepo
    const thirdCallCount = prepareSpy.mock.calls.length;
    listEventPayloads(db, "proj-1");
    expect(prepareSpy.mock.calls.length).toBe(thirdCallCount);

    db.close();
  });

  it("does not recompile statements on repeated calls (memoryFeedbackRepo)", () => {
    const db = openDb();

    // Insert memories first to satisfy FK constraint
    insertMemory(db, makeMemoryInput("m-fb-1"));
    insertMemory(db, makeMemoryInput("m-fb-2"));

    const prepareSpy = vi.spyOn(db, "prepare");

    insertMemoryFeedbackEvent(db, {
      memory_id: "m-fb-1",
      feedback_type: "auto_use",
      previous_importance: 5,
      new_importance: 6,
    });
    const firstCallCount = prepareSpy.mock.calls.length;

    insertMemoryFeedbackEvent(db, {
      memory_id: "m-fb-2",
      feedback_type: "manual",
      previous_importance: 3,
      new_importance: 7,
    });
    const secondCallCount = prepareSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);
    db.close();
  });

  it("does not recompile statements on repeated calls (summarizationFailuresRepo)", () => {
    const db = openDb();

    const prepareSpy = vi.spyOn(db, "prepare");

    insertSummarizationFailure(db, {
      id: "sf-1",
      project_id: "proj-1",
      session_id: "sess-1",
      source_adapter: "test",
      reason: "timeout",
      attempt_count: 1,
      last_error_json: "{}",
    });
    const firstCallCount = prepareSpy.mock.calls.length;

    insertSummarizationFailure(db, {
      id: "sf-2",
      project_id: "proj-1",
      session_id: "sess-2",
      source_adapter: "test",
      reason: "error",
      attempt_count: 2,
      last_error_json: "{}",
    });
    const secondCallCount = prepareSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);

    listSummarizationFailures(db, "proj-1");
    const thirdCallCount = prepareSpy.mock.calls.length;
    listSummarizationFailures(db, "proj-1");
    expect(prepareSpy.mock.calls.length).toBe(thirdCallCount);

    db.close();
  });

  it("creates separate caches for different db instances", () => {
    const db1 = openDb();
    const db2 = openDb();

    const spy1 = vi.spyOn(db1, "prepare");
    const spy2 = vi.spyOn(db2, "prepare");

    // Each db instance gets its own statement cache
    insertMemory(db1, makeMemoryInput("m-db1"));
    const db1FirstCount = spy1.mock.calls.length;

    insertMemory(db2, makeMemoryInput("m-db2"));
    const db2FirstCount = spy2.mock.calls.length;

    // Both should have compiled statements
    expect(db1FirstCount).toBeGreaterThan(0);
    expect(db2FirstCount).toBeGreaterThan(0);

    // Second calls should use cache
    insertMemory(db1, makeMemoryInput("m-db1-2"));
    expect(spy1.mock.calls.length).toBe(db1FirstCount);

    insertMemory(db2, makeMemoryInput("m-db2-2"));
    expect(spy2.mock.calls.length).toBe(db2FirstCount);

    db1.close();
    db2.close();
  });
});
