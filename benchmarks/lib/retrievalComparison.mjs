import { CATEGORY_NAMES } from "./evaluation.mjs";

const METRICS = ["hit_rate", "precision", "recall", "all_evidence_rate"];

/** Compare the same annotated questions, retaining every lost hit and evidence ID. */
export function compareRetrievalReports(before, after) {
  if (before.dataset.sha256 !== after.dataset.sha256 || before.configuration.top_k !== after.configuration.top_k) {
    throw new Error("Corpus checksum and top-k must match");
  }
  const original = new Map(before.questions.map(row => [row.id, row]));
  const updated = new Map(after.questions.map(row => [row.id, row]));
  if (original.size !== updated.size || original.size !== before.questions.length || updated.size !== after.questions.length) {
    throw new Error("Scored question sets must match without duplicates");
  }
  const regressions = [];
  const categories = Object.fromEntries([1, 2, 3, 4].map(category => [CATEGORY_NAMES[category], { lost_hits: [], gained_hits: [], lost_evidence: [], changed_rankings: 0 }]));
  for (const [id, old] of original) {
    const next = updated.get(id);
    if (!next || old.category !== next.category || JSON.stringify(old.evidence) !== JSON.stringify(next.evidence)) throw new Error(`Changed annotations: ${id}`);
    const group = categories[CATEGORY_NAMES[old.category]];
    if (old.hit && !next.hit) group.lost_hits.push(id);
    if (!old.hit && next.hit) group.gained_hits.push(id);
    if (JSON.stringify(old.retrieved) !== JSON.stringify(next.retrieved)) group.changed_rankings++;
    const lost = old.hits.filter(evidence => !next.hits.includes(evidence));
    if (lost.length) group.lost_evidence.push({ id, evidence: lost });
    if ((old.hit && !next.hit) || next.precision < old.precision || next.recall < old.recall || lost.length) {
      regressions.push({ id, category: CATEGORY_NAMES[old.category], lost_hit: old.hit && !next.hit,
        before: { retrieved: old.retrieved, hits: old.hits, precision: old.precision, recall: old.recall },
        after: { retrieved: next.retrieved, hits: next.hits, precision: next.precision, recall: next.recall } });
    }
  }
  const metrics = (old, next) => Object.fromEntries(METRICS.map(key => [key, { before: old[key], after: next[key], delta: next[key] - old[key] }]));
  return { overall: metrics(before.overall, after.overall),
    by_category: Object.fromEntries(Object.entries(categories).map(([name, changes]) => [name,
      { ...changes, metrics: metrics(before.by_category[name], after.by_category[name]) }])), regressions };
}

export function assertNoOverallRegression(comparison) {
  for (const key of ["hit_rate", "precision", "recall"]) {
    if (comparison.overall[key].delta < -1e-12) throw new Error(`Overall ${key} regressed`);
  }
}
