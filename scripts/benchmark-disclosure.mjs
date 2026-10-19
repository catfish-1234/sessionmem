import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getEncoding } from "js-tiktoken";
import { prepareCorpus, captureConversation } from "../benchmarks/lib/evaluation.mjs";
import { blockNetwork } from "../benchmarks/lib/offline.mjs";

const { values } = parseArgs({ options: { output: { type: "string" } } });
const offline = blockNetwork();
const temp = mkdtempSync(join(tmpdir(), "sessionmem-disclosure-"));
try {
  const { openDb } = await import("../dist/core/storage/db.js");
  const { createMemoryCoreService } = await import("../dist/core/api/memoryCoreService.js");
  const root = new URL("../", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("benchmarks/data/provenance.json", root)));
  const raw = readFileSync(new URL("benchmarks/data/locomo10.json", root));
  if (createHash("sha256").update(raw).digest("hex") !== provenance.sha256) throw new Error("Corpus checksum mismatch");
  const corpus = prepareCorpus(JSON.parse(raw));
  const encoding = getEncoding("cl100k_base");
  const count = result => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return encoding.encode(JSON.stringify(result, null, 2)).length;
  };
  const config = join(temp, "config.json");
  writeFileSync(config, JSON.stringify({ retentionDays: 0, semanticSearch: false, temporalRetrieval: false }));
  const rows = [];
  for (const conversation of corpus) {
    const db = openDb();
    try {
      const service = createMemoryCoreService({ db, username: "benchmark", policyConfigPath: config, now: () => new Date("2026-01-01T00:00:00.000Z") });
      await captureConversation(service, conversation);
      for (const question of conversation.questions.filter(q => !q.excluded)) {
        const request = { projectId: conversation.id, query: question.question, limit: 5 };
        const full = await service.retrieveMemories({ ...request, mode: "on-demand" });
        const index = await service.searchMemoryIndex(request);
        const ids = index.memories.map(m => m.id);
        if (JSON.stringify(ids) !== JSON.stringify(full.memories.map(m => m.id))) throw new Error(`Ordering mismatch: ${question.id}`);
        const details = [];
        for (const memoryId of ids) details.push(await service.getMemory({ projectId: conversation.id, memoryId }));
        const timeline = ids.length ? await service.memoryTimeline({ projectId: conversation.id, memoryId: ids[0], limit: 5 }) : null;
        const indexTokens = count(index), firstTokens = details.length ? count(details[0]) : 0;
        rows.push({ id: question.id, returned: ids.length, retrieve: count(full),
          full_details: details.reduce((n, memory) => n + count(memory), 0), index: indexTokens,
          index_first: indexTokens + firstTokens,
          index_timeline_first: indexTokens + (timeline ? count(timeline) : 0) + firstTokens,
          index_all: indexTokens + details.reduce((n, memory) => n + count(memory), 0) });
      }
    } finally { db.close(); }
  }
  offline.assertOffline();
  const keys = ["retrieve", "full_details", "index", "index_first", "index_timeline_first", "index_all"];
  const summary = Object.fromEntries(keys.map(key => {
    const sorted = rows.map(row => row[key]).sort((a, b) => a - b);
    const total = sorted.reduce((a, b) => a + b, 0);
    return [key, { total, mean: total / rows.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }];
  }));
  const report = { schema_version: 1, dataset_sha256: provenance.sha256, questions: rows.length,
    tokenizer: "cl100k_base", serialization: "JSON.stringify(result, null, 2), matching MCP text content",
    top_k: 5, selected_detail: "first ranked ID, no evidence labels used", timeline_limit: 5, network_attempts: 0,
    summary, per_question: rows };
  console.log(JSON.stringify({ ...report, per_question: undefined }, null, 2));
  if (values.output) {
    const path = resolve(values.output); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  }
} finally { rmSync(temp, { recursive: true, force: true }); offline.restore(); }
