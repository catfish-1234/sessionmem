import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Usage: node scripts/summarize-comparison.mjs REPORT.json[.gz] ...");
const reports = paths.map(path => {
  const bytes = readFileSync(path);
  return { path, report: JSON.parse(path.endsWith(".gz") ? gunzipSync(bytes) : bytes) };
});
const base = reports[0].report;
const baseline = new Map(base.questions.map(q => [q.id, q]));
const summary = reports.map(({ path, report }) => {
  if (report.dataset.sha256 !== base.dataset.sha256 || report.questions.length !== baseline.size ||
      new Set(report.questions.map(q => q.id)).size !== baseline.size) throw new Error(`Incomparable corpus/questions: ${path}`);
  let recovered = 0, lost = 0, improvedRecall = 0, regressedRecall = 0;
  for (const row of report.questions) {
    const before = baseline.get(row.id);
    if (!before || row.retrieved.length > 5) throw new Error(`Invalid question: ${row.id}`);
    if (row.hit && !before.hit) recovered++;
    if (!row.hit && before.hit) lost++;
    if (row.recall > before.recall) improvedRecall++;
    if (row.recall < before.recall) regressedRecall++;
  }
  return { path, source_commit: report.source_commit ?? null, harness_commit: report.harness_commit ?? null,
    command: report.command ?? null, configuration: report.configuration, overall: report.overall,
    by_category: report.by_category, paired_vs_first: { recovered_hits: recovered, lost_hits: lost,
      improved_recall_questions: improvedRecall, regressed_recall_questions: regressedRecall } };
});
writeFileSync("benchmarks/measured/summary.json", JSON.stringify({ dataset_sha256: base.dataset.sha256, reports: summary }, null, 2) + "\n");
for (const row of summary) console.log(row.path, JSON.stringify({ ...row.overall, paired: row.paired_vs_first }));
const after = reports.at(-1).report;
writeFileSync("benchmarks/measured/regressions.json", JSON.stringify({
  baseline: reports[0].path, after: reports.at(-1).path,
  questions: after.questions.filter(row => row.recall < baseline.get(row.id).recall).map(row => ({
    id: row.id, question: row.question, evidence: row.evidence,
    before: { retrieved: baseline.get(row.id).retrieved, recall: baseline.get(row.id).recall },
    after: { retrieved: row.retrieved, recall: row.recall },
  })),
}, null, 2) + "\n");
