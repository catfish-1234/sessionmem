import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { compareRetrievalReports, assertNoOverallRegression } from "../benchmarks/lib/retrievalComparison.mjs";

const { values } = parseArgs({ options: {
  before: { type: "string" }, after: { type: "string" }, output: { type: "string" },
  "require-no-regression": { type: "boolean" },
} });
if (!values.before || !values.after) throw new Error("--before and --after are required");
const read = path => JSON.parse(path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path, "utf8"));
const report = compareRetrievalReports(read(values.before), read(values.after));
console.log(JSON.stringify({ overall: report.overall, by_category: Object.fromEntries(Object.entries(report.by_category)
  .map(([name, value]) => [name, { lost_hits: value.lost_hits.length, gained_hits: value.gained_hits.length, changed_rankings: value.changed_rankings }])) }, null, 2));
if (values.output) {
  mkdirSync(dirname(values.output), { recursive: true });
  writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
}
if (values["require-no-regression"]) assertNoOverallRegression(report);
