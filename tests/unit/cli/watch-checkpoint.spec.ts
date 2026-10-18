import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectWatchCheckpoint, watchCheckpointPath, type WatchCheckpoint } from "../../../src/cli/watchCheckpoint.js";
let home: string;
let dbPath: string;
let value: WatchCheckpoint;
const now = Date.parse("2026-10-18T00:00:00Z");
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sessionmem-checkpoint-"));
  dbPath = join(home, "memories.db");
  mkdirSync(home, { recursive: true });
  value = { dbPath, completedAt: new Date(now).toISOString(), intervalSeconds: 5, checkpointCount: 2,
    summary: { filesFound: 2, sessionsImported: 0, memoriesCreated: 0, skipped: 2, errors: 0 } };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
function inspect(at = now) { writeFileSync(watchCheckpointPath(dbPath), JSON.stringify(value)); return inspectWatchCheckpoint(dbPath, at); }
it("treats unchanged captured transcripts as healthy", () => { expect(inspect()).toContain("2 transcript checkpoint(s)"); });
it("allows an idle installation with no transcripts", () => { value.checkpointCount = 0; value.summary.filesFound = 0; expect(inspect()).toContain("0 source file(s)"); });
it("rejects stale, future and invalid timestamps", () => {
  expect(() => inspect(now + 120001)).toThrow(/stale/);
  expect(() => inspect(now - 60001)).toThrow(/stale/);
  value.completedAt = "invalid"; expect(() => inspect()).toThrow(/invalid/);
});
it("scales freshness with the polling interval", () => { value.intervalSeconds = 300; expect(inspect(now + 700000)).toContain("700s ago"); expect(() => inspect(now + 900001)).toThrow(/stale/); });
it("rejects a mismatched database and pending or failed capture", () => {
  value.dbPath += "other"; expect(() => inspect()).toThrow(/different database/);
  value.dbPath = dbPath; value.checkpointCount = 0; expect(() => inspect()).toThrow(/none checkpointed/);
  value.summary.errors = 1; expect(() => inspect()).toThrow(/capture error/);
});
it("rejects invalid intervals and counts", () => {
  value.intervalSeconds = -1; expect(() => inspect()).toThrow(/interval/);
  value.intervalSeconds = 5; value.checkpointCount = -1; expect(() => inspect()).toThrow(/count/);
});
it("reports missing and corrupt checkpoints", () => {
  expect(() => inspectWatchCheckpoint(dbPath, now)).toThrow();
  writeFileSync(watchCheckpointPath(dbPath), "{"); expect(() => inspectWatchCheckpoint(dbPath, now)).toThrow();
});
