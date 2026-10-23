import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliContext } from "../../../src/cli/context.js";
import { sweepTranscripts } from "../../../src/cli/transcriptSweep.js";
import { scopesCommand } from "../../../src/cli/commands/scopes.js";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temporary() { const dir = mkdtempSync(join(tmpdir(), "sessionmem-scope-capture-")); dirs.push(dir); return dir; }

describe("local capture scope overrides", () => {
  it("uses a transcript's working directory and safely replays a changed explicit override", async () => {
    const dir = temporary(), transcripts = join(dir, "transcripts"), cwd = join(dir, "atlas");
    mkdirSync(transcripts); mkdirSync(cwd);
    const timestamp = "2026-01-01T00:00:00.000Z";
    writeFileSync(join(transcripts, "session.jsonl"), [
      { timestamp, type: "session_meta", payload: { id: "s", cwd } },
      { timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Alice uses SQLite." }] } },
    ].map(row => JSON.stringify(row)).join("\n") + "\n");
    const context = createCliContext({ dbPath: ":memory:" });
    try {
      const first = await sweepTranscripts(context, { transcriptsDir: transcripts });
      expect(first).toMatchObject({ sessionsImported: 1, memoriesCreated: 1, errors: 0 });
      expect(context.db.prepare("SELECT scope FROM sessions").all()).toEqual([{ scope: "atlas" }]);
      expect(context.db.prepare("SELECT DISTINCT scope FROM memory_entities").all()).toEqual([{ scope: "atlas" }]);
      expect(await sweepTranscripts(context, { transcriptsDir: transcripts })).toMatchObject({ skipped: 1, sessionsImported: 0 });
      expect(await sweepTranscripts(context, { transcriptsDir: transcripts, scope: "release" })).toMatchObject({ sessionsImported: 1, memoriesCreated: 0, errors: 0 });
      expect(context.db.prepare("SELECT scope FROM memories").all()).toEqual([{ scope: "release" }]);
      expect(context.db.prepare("SELECT COUNT(*) AS n FROM session_events").get()).toEqual({ n: 1 });
      expect(await sweepTranscripts(context, { transcriptsDir: transcripts, scope: "release" })).toMatchObject({ skipped: 1, sessionsImported: 0 });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const projectId = (context.db.prepare("SELECT project_id FROM memories").get() as { project_id: string }).project_id;
      scopesCommand({ json: true }, { ...context, projectId });
      expect(JSON.parse(spy.mock.calls[0][0])).toMatchObject({ scopes: [{ scope: "release", memories: 1, sessions: 1 }] });
    } finally { context.db.close(); }
  });

  it("honors the operator's environment default for new sessions", async () => {
    vi.stubEnv("SESSIONMEM_SCOPE", "operator-context");
    const context = createCliContext({ dbPath: ":memory:", projectId: "p" });
    try {
      await context.service.storeMemory({ memoryId: "m", projectId: "p", sessionId: "s", sourceAdapter: "test", kind: "fact", content: "A status note.", importance: 5 });
      expect(context.db.prepare("SELECT scope FROM memories").get()).toEqual({ scope: "operator-context" });
    } finally { context.db.close(); }
  });
});
