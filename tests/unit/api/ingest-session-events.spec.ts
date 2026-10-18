import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { MAX_INGEST_EVENTS } from "../../../src/core/api/contracts.js";
import {
  countAllSessionEvents,
  listSessionEventsBySession,
} from "../../../src/core/storage/sessionEventsRepo.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("ingestSessionEvents (HIGH-2: transactional + deduped)", () => {
  const events = [
    {
      id: "evt-1",
      eventIndex: 0,
      eventType: "tool_use",
      payloadJson: JSON.stringify({ tool: "read" }),
    },
    {
      id: "evt-2",
      eventIndex: 1,
      eventType: "user_message",
      payloadJson: JSON.stringify({ text: "hello" }),
    },
  ];

  it("ingests events and reports the number written", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const result = await service.ingestSessionEvents({
      projectId: "proj-events",
      sessionId: "sess-events",
      events,
    });

    expect(result.ok).toBe(true);
    expect(result.ingested).toBe(2);
    expect(countAllSessionEvents(db, "proj-events")).toBe(2);

    db.close();
  });

  it("is idempotent on (projectId, sessionId, eventIndex) — re-ingestion is a no-op", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    await service.ingestSessionEvents({
      projectId: "proj-dedup",
      sessionId: "sess-dedup",
      // Fresh ids on re-ingest to prove dedup is on the logical key, not the PK.
      events,
    });

    const second = await service.ingestSessionEvents({
      projectId: "proj-dedup",
      sessionId: "sess-dedup",
      events: events.map((e) => ({ ...e, id: `${e.id}-again` })),
    });

    expect(second.ok).toBe(true);
    expect(second.ingested).toBe(0);
    expect(countAllSessionEvents(db, "proj-dedup")).toBe(2);

    db.close();
  });

  it("refreshes mutable events only when requested, preserving identity and redaction", async () => {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db });
      const request = { projectId: "project", sessionId: "session", events: [{
        id: "bubble", eventType: "message:assistant", payloadJson: '{"text":"Partial response"}',
        createdAt: "2026-10-17T10:00:00.000Z",
      }] };
      await service.ingestSessionEvents(request);
      const original = listSessionEventsBySession(db, "project", "session")[0];
      const updated = { ...request, events: [{ ...request.events[0], payloadJson: '{"text":"password=super-secret-value"}' }] };
      expect((await service.ingestSessionEvents(updated)).ingested).toBe(0);
      expect(listSessionEventsBySession(db, "project", "session")[0]).toEqual(original);
      expect((await service.ingestSessionEvents({ ...updated, replaceExisting: true })).ingested).toBe(1);
      const saved = listSessionEventsBySession(db, "project", "session");
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ id: original.id, event_index: original.event_index, created_at: original.created_at });
      expect(saved[0].payload_json).not.toContain("super-secret-value");
      expect((await service.ingestSessionEvents({ ...updated, replaceExisting: true })).ingested).toBe(0);
      // A matching ID owned by another project/session cannot be overwritten.
      await service.ingestSessionEvents({ ...request, projectId: "other", replaceExisting: true });
      expect(listSessionEventsBySession(db, "project", "session")).toEqual(saved);
      expect(listSessionEventsBySession(db, "other", "session")).toEqual([]);
    } finally { db.close(); }
  });

  it(`accepts a full batch of exactly MAX_INGEST_EVENTS (${MAX_INGEST_EVENTS}) events`, async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const maxEvents = Array.from({ length: MAX_INGEST_EVENTS }, (_, i) => ({
      id: `evt-max-${i}`,
      eventIndex: i,
      eventType: "tool_use",
      payloadJson: JSON.stringify({ i }),
    }));

    const result = await service.ingestSessionEvents({
      projectId: "proj-max",
      sessionId: "sess-max",
      events: maxEvents,
    });

    expect(result.ok).toBe(true);
    expect(result.ingested).toBe(MAX_INGEST_EVENTS);

    db.close();
  });

  it(`rejects a batch of MAX_INGEST_EVENTS + 1 (${MAX_INGEST_EVENTS + 1}) events`, async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const tooMany = Array.from({ length: MAX_INGEST_EVENTS + 1 }, (_, i) => ({
      id: `evt-over-${i}`,
      eventIndex: i,
      eventType: "tool_use",
      payloadJson: JSON.stringify({ i }),
    }));

    await expect(
      service.ingestSessionEvents({
        projectId: "proj-over",
        sessionId: "sess-over",
        events: tooMany,
      }),
    ).rejects.toThrow();

    // Nothing from the rejected batch is persisted (validation happens before
    // the transaction opens).
    expect(countAllSessionEvents(db, "proj-over")).toBe(0);

    db.close();
  });

  it("redacts secrets from payloadJson before storing", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });

    const payload = JSON.stringify({
      tool: "bash",
      args: { command: "echo sk-abcdefghijklmnop" },
    });
    const result = await service.ingestSessionEvents({
      projectId: "proj-redact",
      sessionId: "sess-redact",
      events: [
        {
          id: "evt-redact",
          eventIndex: 0,
          eventType: "tool_use",
          payloadJson: payload,
        },
      ],
    });

    expect(result.ok).toBe(true);

    const stored = listSessionEventsBySession(db, "proj-redact", "sess-redact");
    expect(JSON.stringify(stored)).not.toContain("sk-abcdef");

    db.close();
  });
});
