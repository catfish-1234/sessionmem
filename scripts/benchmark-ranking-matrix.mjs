import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { aggregate, captureConversation, recallConversation, prepareCorpus, CATEGORY_NAMES } from "../benchmarks/lib/evaluation.mjs";
import { blockNetwork } from "../benchmarks/lib/offline.mjs";

const { values } = parseArgs({ options: { semantic: { type: "boolean" }, "output-dir": { type: "string", default: "benchmarks/results/ranking-matrix" } } });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const offline = blockNetwork();
const temp = mkdtempSync(join(tmpdir(), "sessionmem-ranking-"));
try {
  const { openDb } = await import("../dist/core/storage/db.js");
  const { createMemoryCoreService } = await import("../dist/core/api/memoryCoreService.js");
  const { loadLocalSemanticEmbedder } = await import("../dist/core/embed/localSemanticEmbedder.js");
  const root = new URL("../", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("benchmarks/data/provenance.json", root)));
  const raw = readFileSync(new URL("benchmarks/data/locomo10.json", root));
  if (createHash("sha256").update(raw).digest("hex") !== provenance.sha256) throw new Error("Corpus checksum mismatch");
  const corpus = prepareCorpus(JSON.parse(raw));
  const embedder = values.semantic ? await loadLocalSemanticEmbedder() : null;
  if (values.semantic && !embedder) throw new Error("Local semantic model unavailable");
  const variants = ["legacy", "entity-coverage", "adaptive-bm25", "hub-additive", "adaptive-hub-additive"];
  const results = Object.fromEntries(variants.map(name => [name, { questions: [], conversations: [] }]));
  const config = join(temp, "config.json");
  const policy = name => ({ retentionDays: 0, semanticSearch: Boolean(values.semantic), temporalRetrieval: false,
    entityLinkBoost: name === "entity-coverage", retrievalRanking: name === "entity-coverage" ? "legacy" : name });
  for (const conversation of corpus) {
    const db = openDb();
    try {
      writeFileSync(config, JSON.stringify(policy("legacy")));
      const service = createMemoryCoreService({ db, username: "benchmark", policyConfigPath: config,
        now: () => new Date("2026-01-01T00:00:00.000Z"), semanticEmbedder: embedder });
      const start = performance.now();
      const memories = await captureConversation(service, conversation);
      const capture_ms = performance.now() - start;
      // All variants see the identical capture. On-demand recall never changes access counts.
      for (const name of variants) {
        writeFileSync(config, JSON.stringify(policy(name)));
        const rows = await recallConversation(service, conversation, 5);
        results[name].questions.push(...rows);
        results[name].conversations.push({ id: conversation.id, memories, capture_ms, ...aggregate(rows) });
      }
    } finally { db.close(); }
  }
  offline.assertOffline();
  const directory = resolve(values["output-dir"]); mkdirSync(directory, { recursive: true });
  for (const [name, result] of Object.entries(results)) {
    const report = { schema_version: 1, source_commit: sourceCommit,
      command: ["node", "scripts/benchmark-ranking-matrix.mjs", ...process.argv.slice(2)],
      dataset: { ...provenance, conversations: corpus.length, turns: 5882, sessions: 272, total_questions: 1986 },
      configuration: { top_k: 5, capture_clock: "2026-01-01T00:00:00.000Z", mode: "on-demand", depth: "default",
        capture_api: "storeMemory", recall_api: "retrieveMemories", embedding: embedder?.id ?? "deterministicEmbed",
        semantic_requested: Boolean(values.semantic), temporal_retrieval: false, entity_link_boost: name === "entity-coverage",
        retrieval_ranking: name, shared_capture: true, network_attempts: 0 },
      overall: aggregate(result.questions),
      by_category: Object.fromEntries([1, 2, 3, 4].map(category => [CATEGORY_NAMES[category], aggregate(result.questions.filter(row => row.category === category))])),
      ...result, excluded_questions: corpus.flatMap(c => c.questions.filter(q => q.excluded)) };
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(name, JSON.stringify(report.overall));
  }
} finally { rmSync(temp, { recursive: true, force: true }); offline.restore(); }
