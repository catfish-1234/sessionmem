import { describe, expect, it } from "vitest";
// @ts-expect-error shared with the offline benchmark runner
import { compareRetrievalReports, assertNoOverallRegression } from "../../../benchmarks/lib/retrievalComparison.mjs";

function report(hit = true, hits = ["e1", "e2"], retrieved = ["e1", "e2"]) {
  const metrics = { hit_rate: Number(hit), precision: hits.length / retrieved.length, recall: hits.length / 2, all_evidence_rate: Number(hits.length === 2) };
  return { dataset: { sha256: "same" }, configuration: { top_k: 5 }, overall: metrics,
    by_category: Object.fromEntries(["multi-hop", "temporal", "open-domain", "single-hop"].map(name => [name, metrics])),
    questions: [{ id: "q1", category: 2, evidence: ["e1", "e2"], hit, hits, retrieved, precision: metrics.precision, recall: metrics.recall }] };
}
describe("retrieval regression accounting", () => {
  it("retains partial evidence losses even when hit rate is unchanged", () => {
    const compared = compareRetrievalReports(report(), report(true, ["e1"], ["e1", "other"]));
    expect(compared.by_category.temporal.lost_hits).toEqual([]);
    expect(compared.by_category.temporal.lost_evidence).toEqual([{ id: "q1", evidence: ["e2"] }]);
    expect(compared.regressions).toHaveLength(1);
    expect(() => assertNoOverallRegression(compared)).toThrow("precision");
  });
  it("keeps lost hits in their category and gates all three primary metrics", () => {
    const compared = compareRetrievalReports(report(), report(false, [], ["other"]));
    expect(compared.by_category.temporal.lost_hits).toEqual(["q1"]);
    expect(() => assertNoOverallRegression(compared)).toThrow("hit_rate");
    expect(() => assertNoOverallRegression(compareRetrievalReports(report(), report()))).not.toThrow();
    const recallOnly = compareRetrievalReports(report(), report());
    recallOnly.overall.recall.delta = -0.01;
    expect(() => assertNoOverallRegression(recallOnly)).toThrow("recall");
  });
  it("rejects changed question sets, evidence, corpus or budget", () => {
    const before = report();
    for (const change of [(r: any) => r.dataset.sha256 = "other", (r: any) => r.configuration.top_k = 10,
      (r: any) => r.questions.pop(), (r: any) => r.questions[0].evidence.pop()]) {
      const after = report(); change(after);
      expect(() => compareRetrievalReports(before, after)).toThrow();
    }
  });
});
