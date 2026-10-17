import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { aggregate, captureConversation, recallConversation, prepareCorpus, CATEGORY_NAMES } from "../benchmarks/lib/evaluation.mjs";
import { blockNetwork } from "../benchmarks/lib/offline.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const CAPTURE_CLOCK = "2026-01-01T00:00:00.000Z";

async function main() {
  const { values } = parseArgs({ options: {
    "top-k": { type: "string", default: "5" },
    output: { type: "string" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("Usage: npm run benchmark -- [--top-k 5] [--output benchmarks/results/locomo.json]");
    return;
  }
  const topK = Number(values["top-k"]);
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new Error("--top-k must be an integer from 1 to 100");
  const offline = blockNetwork();
  const temp = mkdtempSync(join(tmpdir(), "sessionmem-locomo-"));
  try {
    let openDb, createMemoryCoreService;
    try {
      ({ openDb } = await import("../dist/core/storage/db.js"));
      ({ createMemoryCoreService } = await import("../dist/core/api/memoryCoreService.js"));
    } catch (error) {
      throw new Error("Cannot load built sessionmem. Run npm run build first.", { cause: error });
    }
    const provenance = JSON.parse(readFileSync(join(root, "benchmarks/data/provenance.json"), "utf8"));
    const raw = readFileSync(join(root, "benchmarks/data/locomo10.json"));
    const digest = createHash("sha256").update(raw).digest("hex");
    if (digest !== provenance.sha256) throw new Error("Corpus checksum does not match provenance.json");
    const corpus = prepareCorpus(JSON.parse(raw));
    // Never read the user's config or touch their database. Equal capture times
    // isolate retrieval from import order and wall-clock recency effects.
    const policyConfigPath = join(temp, "config.json");
    writeFileSync(policyConfigPath, JSON.stringify({ retentionDays: 0, redactionEnabled: true, team: { enabled: false } }));
    const rows = [], excluded = [], conversations = [];
    for (const conversation of corpus) {
      const db = openDb();
      try {
        const service = createMemoryCoreService({
          db, username: "benchmark", policyConfigPath,
          policyConfig: { localOnly: true, allowExternalProviders: false },
          now: () => new Date(CAPTURE_CLOCK),
        });
        const start = performance.now();
        const memories = await captureConversation(service, conversation);
        const capture_ms = performance.now() - start;
        const results = await recallConversation(service, conversation, topK);
        rows.push(...results);
        excluded.push(...conversation.questions.filter((q) => q.excluded));
        conversations.push({ id: conversation.id, sessions: conversation.sessions.length, memories, capture_ms, ...aggregate(results) });
      } finally { db.close(); }
    }
    offline.assertOffline();
    const excludedCounts = {};
    for (const question of excluded) excludedCounts[question.excluded] = (excludedCounts[question.excluded] ?? 0) + 1;
    const report = {
      schema_version: 1,
      dataset: { ...provenance, conversations: corpus.length, sessions: conversations.reduce((n, c) => n + c.sessions, 0),
        turns: conversations.reduce((n, c) => n + c.memories, 0), total_questions: rows.length + excluded.length },
      configuration: { top_k: topK, capture_clock: CAPTURE_CLOCK, importance: 5, mode: "on-demand", depth: "default",
        capture_api: "storeMemory", recall_api: "retrieveMemories", embedding: "deterministicEmbed", network_attempts: 0 },
      runtime: { node: process.version, platform: process.platform, arch: process.arch,
        sessionmem_version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version },
      overall: aggregate(rows),
      by_category: Object.fromEntries([1, 2, 3, 4].map((category) => [CATEGORY_NAMES[category], aggregate(rows.filter((r) => r.category === category))])),
      excluded_counts: excludedCounts,
      conversations,
      questions: rows,
      excluded_questions: excluded,
    };
    console.log(`LoCoMo: ${corpus.length} conversations, ${report.dataset.sessions} sessions, ${report.dataset.turns} turns`);
    console.log(`${rows.length}/${report.dataset.total_questions} questions scored; exclusions: ${JSON.stringify(excludedCounts)}`);
    console.log(`Macro metrics @${topK} (annotated turn evidence):`);
    for (const key of ["hit_rate", "precision", "recall", "all_evidence_rate"]) console.log(`  ${key}: ${(report.overall[key] * 100).toFixed(2)}%`);
    console.log(`Recall latency (ms): ${Object.entries(report.overall.latency_ms).map(([key, value]) => `${key}=${value.toFixed(2)}`).join(", ")}`);
    console.log("Category              Questions  Hit rate  Precision  Recall");
    for (const [name, metrics] of Object.entries(report.by_category)) {
      console.log(`${name.padEnd(22)}${String(metrics.questions).padEnd(11)}${(100 * metrics.hit_rate).toFixed(2).padEnd(10)}${(100 * metrics.precision).toFixed(2).padEnd(11)}${(100 * metrics.recall).toFixed(2)}`);
    }
    if (values.output) {
      const path = resolve(values.output);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Detailed JSON: ${path}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
    offline.restore();
  }
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error.message}`);
  if (error.cause) console.error(error.cause.message);
  process.exitCode = 1;
});
