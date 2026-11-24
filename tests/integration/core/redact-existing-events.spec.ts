import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";
import { insertSessionEvent, listSessionEventsBySession } from "../../../src/core/storage/sessionEventsRepo.js";
import { redactScanCommand } from "../../../src/cli/commands/redactScan.js";
import type { CliContext } from "../../../src/cli/context.js";

/**
 * redact-scan used to scrub only the memories table. Session events, the raw tool and transcript
 * payloads summaries are built from, kept the redaction of whatever version ingested them, so a
 * secret format that version did not know stayed on disk. Events are inserted directly here,
 * bypassing ingest redaction, to stand for rows an older version wrote.
 */

const PROJECT_ID = "project-redact-events";
// Assembled so the repository's secret scanners do not read the fixture as a real token.
const TOKEN = "gsk_" + "W8kP2xQ9".repeat(6) + "Ab3D";
const KEY_BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7" + "x9Qz".repeat(2);

function seed(db: ReturnType<typeof openDb>, index: number, payload: unknown, sessionId = "s1") {
  insertSessionEvent(db, {
    id: `event-${sessionId}-${index}`,
    project_id: PROJECT_ID,
    session_id: sessionId,
    event_index: index,
    event_type: "tool_use",
    payload_json: typeof payload === "string" ? payload : JSON.stringify(payload),
    created_at: null,
  });
}

function payloads(db: ReturnType<typeof openDb>, sessionId = "s1"): string[] {
  return listSessionEventsBySession(db, PROJECT_ID, sessionId).map((event) => event.payload_json);
}

describe("redactExisting over stored session events", () => {
  afterEach(() => vi.restoreAllMocks());

  it("counts events a dry run would redact, and changes nothing", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seed(db, 0, { tool: "Bash", output: `export GROQ_API_KEY=${TOKEN}` });
    seed(db, 1, { tool: "Read", output: "nothing secret here" });

    const result = await service.call("redactExisting", { projectId: PROJECT_ID, apply: false });

    expect(result).toMatchObject({ ok: true, eventsMatched: 1, eventsUpdated: 0 });
    expect(payloads(db)[0]).toContain(TOKEN);
    db.close();
  });

  it("rewrites only the events that hold a secret, and leaves them valid JSON", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seed(db, 0, { tool: "Bash", output: `export GROQ_API_KEY=${TOKEN}`, exit: 0 });
    seed(db, 1, { tool: "Bash", output: `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n${KEY_BODY}` });
    seed(db, 2, { tool: "Read", output: "nothing secret here" });

    const result = await service.call("redactExisting", { projectId: PROJECT_ID, apply: true });

    expect(result).toMatchObject({ ok: true, eventsMatched: 2, eventsUpdated: 2 });
    const [token, key, plain] = payloads(db);
    expect(token).not.toContain(TOKEN);
    expect(JSON.parse(token!)).toMatchObject({ tool: "Bash", exit: 0 });
    expect(key).not.toContain(KEY_BODY.slice(0, 20));
    expect(JSON.parse(key!).output).toBe("[REDACTED_PRIVATE_KEY]");
    expect(plain).toBe(JSON.stringify({ tool: "Read", output: "nothing secret here" }));
    db.close();
  });

  it("scrubs every session of the project, and no other project", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seed(db, 0, { output: TOKEN }, "s1");
    seed(db, 0, { output: TOKEN }, "s2");
    insertSessionEvent(db, {
      id: "other-project", project_id: "someone-else", session_id: "s1", event_index: 0,
      event_type: "tool_use", payload_json: JSON.stringify({ output: TOKEN }), created_at: null,
    });

    await service.call("redactExisting", { projectId: PROJECT_ID, apply: true });

    expect(payloads(db, "s1")[0]).not.toContain(TOKEN);
    expect(payloads(db, "s2")[0]).not.toContain(TOKEN);
    expect(listSessionEventsBySession(db, "someone-else", "s1")[0]!.payload_json).toContain(TOKEN);
    db.close();
  });

  it("reports events in the redact-scan output", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    seed(db, 0, { output: TOKEN });
    const ctx = { db, service, projectId: PROJECT_ID, dbPath: ":memory:" } as unknown as CliContext;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await redactScanCommand({}, ctx);
    await redactScanCommand({ apply: true }, ctx);

    const lines = log.mock.calls.map((call) => call.join(" "));
    expect(lines).toContain("Found 1 stored session events with potential secrets (run with --apply to redact them)");
    expect(lines).toContain("Redacted 1 stored session events.");
    expect(lines.join("\n")).not.toContain(TOKEN);
    db.close();
  });
});
