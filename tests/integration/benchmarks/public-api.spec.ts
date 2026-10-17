import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";
import { captureConversation, prepareCorpus, recallConversation } from "../../../benchmarks/lib/evaluation.mjs";

describe("benchmark capture and recall through the public service", () => {
  it("preserves sessions and repeats rankings without access boosts or wall-clock drift", async () => {
    const temp = mkdtempSync(join(tmpdir(), "locomo-api-test-"));
    const db = openDb();
    try {
      const policyConfigPath = join(temp, "config.json");
      writeFileSync(policyConfigPath, JSON.stringify({ retentionDays: 0, redactionEnabled: true }));
      const now = new Date("2026-01-01T00:00:00.000Z");
      const service = createMemoryCoreService({ db, now: () => now, policyConfigPath, username: "benchmark" });
      const corpus = prepareCorpus([{
        sample_id: "test", conversation: {
          session_1_date_time: "1 May 2023", session_1: [{ dia_id: "D1:1", speaker: "Mara", text: "I moved to Portland." }],
          session_2_date_time: "2 May 2023", session_2: [{ dia_id: "D2:1", speaker: "Alex", text: "The bicycle repair costs $40." }],
        },
        qa: [
          { question: "Where does Mara live?", answer: "Portland", category: 4, evidence: ["D1:1"] },
          { question: "How much did bicycle repair cost?", answer: "$40", category: 4, evidence: ["D2:1"] },
        ],
      }])[0];
      expect(await captureConversation(service, corpus)).toBe(2);
      const memory = await service.getMemory({ projectId: "test", memoryId: "test/D1:1" });
      expect(memory).toMatchObject({ ok: true, memory: { sessionId: "test/session_1", createdAt: now.toISOString(), updatedAt: now.toISOString() } });
      const first = await recallConversation(service, corpus, 1);
      const second = await recallConversation(service, { ...corpus, questions: [...corpus.questions].reverse() }, 1);
      expect(first.every((r) => r.retrieved.length === 1)).toBe(true);
      const strip = (rows) => rows.map(({ latency_ms: _latency, ...row }) => row).sort((a, b) => a.id.localeCompare(b.id));
      expect(strip(first)).toEqual(strip(second));
      const memories = await service.listMemories({ projectId: "test" });
      expect(memories.memories.every((m) => m.accessCount === 0)).toBe(true);
    } finally { db.close(); rmSync(temp, { recursive: true, force: true }); }
  });

  it("uses the injected clock for candidate eligibility as well as capture", async () => {
    const db = openDb();
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = createMemoryCoreService({ db, now: () => now, policyConfigPath: "/nonexistent/benchmark-config.json" });
    try {
      expect(await service.storeMemory({ projectId: "clock", sessionId: "s", memoryId: "m", sourceAdapter: "test", kind: "fact", importance: 1, content: "A low importance bicycle note." })).toMatchObject({ ok: true });
      expect(await service.retrieveMemories({ projectId: "clock", query: "zzznomatch", mode: "on-demand" })).toMatchObject({ ok: true, total: 1 });
      now = new Date("2027-01-01T00:00:00.000Z");
      expect(await service.retrieveMemories({ projectId: "clock", query: "zzznomatch", mode: "on-demand" })).toMatchObject({ ok: true, total: 0 });
    } finally { db.close(); }
  });
});
