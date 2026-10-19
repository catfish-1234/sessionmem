import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { prepareCorpus, aggregate, scoreQuestion, CATEGORY_NAMES } from "../benchmarks/lib/evaluation.mjs";
import { applyRedaction } from "../dist/core/summarize/redaction.js";

const { values } = parseArgs({ options: {
  competitor: { type: "string" }, source: { type: "string" }, output: { type: "string" },
  python: { type: "string", default: "python3" }, bun: { type: "string", default: "bun" },
  "model-dir": { type: "string" },
  "chroma-python": { type: "string" },
} });
if (!["mem0", "claude-sqlite", "claude-chroma", "graphiti-episodes", "cognee-chunks"].includes(values.competitor) || !values.source || !values.output) {
  throw new Error("Required: --competitor mem0|claude-sqlite|claude-chroma --source PATH --output PATH [--model-dir PATH] [--python PATH] [--bun PATH] [--chroma-python PATH]");
}
if (values.competitor === "claude-chroma" && (!values["chroma-python"] || !values["model-dir"])) throw new Error("Chroma requires --chroma-python and --model-dir");
const root = new URL("../", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("benchmarks/data/provenance.json", root)));
const raw = readFileSync(new URL("benchmarks/data/locomo10.json", root));
if (createHash("sha256").update(raw).digest("hex") !== provenance.sha256) throw new Error("Corpus checksum mismatch");
const corpus = prepareCorpus(JSON.parse(raw));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const source = resolve(values.source);
const sourceCommit = git("-C", source, "rev-parse", "HEAD");
const harnessCommit = git("rev-parse", "HEAD");
if (git("-C", source, "status", "--porcelain", "--untracked-files=no")) throw new Error("Competitor source must be unmodified");
const temp = mkdtempSync(join(tmpdir(), "locomo-compare-"));
try {
  const input = join(temp, "input.json"), output = join(temp, "output.json");
  // Send only dialogue and original query text to the adapters. Relevance labels
  // and answers stay in the scoring process. Apply identical production redaction.
  writeFileSync(input, JSON.stringify(corpus.map(c => ({ id: c.id,
    sessions: c.sessions.map(s => ({ ...s, turns: s.turns.map(t => ({ ...t, content: applyRedaction(t.content, { redactionEnabled: true }).text })) })),
    questions: c.questions.filter(q => !q.excluded).map(({ id, question }) => ({ id, question })),
  }))));
  const component = ["graphiti-episodes", "cognee-chunks"].includes(values.competitor);
  const python = values.competitor === "mem0" || component;
  const adapter = component ? "raw-components.py" : values.competitor === "mem0" ? "mem0.py" : "claude-sqlite.ts";
  execFileSync(python ? values.python : values.bun,
    [new URL(`benchmarks/adapters/${adapter}`, root).pathname, "--input", input, "--output", output, "--source", source,
      ...(values["model-dir"] ? ["--model-dir", resolve(values["model-dir"])] : []),
      ...(component ? ["--variant", values.competitor] : []),
      ...(values["chroma-python"] ? ["--chroma-python", resolve(values["chroma-python"])] : [])],
    { stdio: "inherit", cwd: temp, env: { ...process.env, MEM0_DIR: temp, CLAUDE_MEM_DATA_DIR: join(temp, "claude"), CLAUDE_MEM_LOG_LEVEL: "SILENT" } });
  const measured = JSON.parse(readFileSync(output));
  const measuredRows = new Map(measured.questions.map(q => [q.id, q]));
  const rows = corpus.flatMap(c => {
    const allowed = new Set(c.sessions.flatMap(s => s.turns.map(t => t.id)));
    return c.questions.filter(q => !q.excluded).map(q => {
      const result = measuredRows.get(q.id);
      if (!result || result.retrieved.length > 5 || result.retrieved.some(id => !allowed.has(id)) || !Number.isFinite(result.latency_ms)) throw new Error(`Invalid result: ${q.id}`);
      return { ...q, ...result, ...scoreQuestion(q.evidence, result.retrieved) };
    });
  });
  if (rows.length !== measured.questions.length) throw new Error("Missing/extra question results");
  const report = { schema_version: 1, competitor: values.competitor,
    source_commit: sourceCommit, harness_commit: harnessCommit,
    command: ["node", "scripts/compare.mjs", ...process.argv.slice(2)],
    dataset: provenance, configuration: { top_k: 5, capture: "raw dialogue turns", redaction: true },
    overall: aggregate(rows), by_category: Object.fromEntries([1, 2, 3, 4].map(cat => [CATEGORY_NAMES[cat], aggregate(rows.filter(q => q.category === cat))])),
    ...measured, questions: rows,
    excluded_questions: corpus.flatMap(c => c.questions.filter(q => q.excluded)),
  };
  mkdirSync(dirname(resolve(values.output)), { recursive: true });
  writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.overall, null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
