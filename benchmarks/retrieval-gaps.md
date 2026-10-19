# Retrieval and automatic memory evaluation

Measured on 2026-10-19. Main at `4b5653227be673756eaf0e4c039730c6c4554227` (1.7.0) was built and evaluated first, before implementation. Default BM25 reproduced 63.92% hit, 14.05% precision and 57.45% recall. Only optional MiniLM reproduced 66.47% hit, 14.77% precision and 59.76% recall.

Every run scores the same 1,527 questions over 5,882 turns, with top-5 retrieval and unchanged exclusions and evidence denominators. Corpus SHA-256: `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`. Capture and recall clocks remain pinned to `2026-01-01T00:00:00.000Z`. No answers, relevance annotations or question categories enter relevance scoring.

## Shipping defaults

Entity coverage is enabled for BM25, including unavailable-model fallback. Active MiniLM retains the original fusion. Explicit overrides win. Temporal retrieval and the source-informed alternatives remain opt-in. Defaults pass hit rate, precision and recall separately; improvements do not erase individual losses.

| Mode | Hit before | Hit after | Precision before | Precision after | Recall before | Recall after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bm25 | 63.92% | 64.44% | 14.05% | 14.32% | 57.45% | 58.27% |
| hybrid | 66.47% | 66.47% | 14.77% | 14.77% | 59.76% | 59.76% |

## Prespecified ranking variants

Coverage uses an 80:20 blend and rare-name weights. The source-informed variants test query-length sigmoid normalization, up to eight hub-damped entity names and normalized additive fusion. Additive semantic gating is fixed at 0.2. No weight sweeps or category-specific exceptions were used. See [source notes](retrieval-source-notes.md) for exact parameters and differences from Mem0.

| Variant | BM25 hit | Precision | Recall | MiniLM hit | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy | 63.92% | 14.05% | 57.45% | 66.47% | 14.77% | 59.76% |
| entity-coverage | 64.44% | 14.32% | 58.27% | 66.27% | 14.80% | 59.67% |
| adaptive-bm25 | 63.79% | 13.99% | 57.27% | 66.54% | 14.75% | 59.72% |
| hub-additive | 61.82% | 13.43% | 55.70% | 59.14% | 13.24% | 52.48% |
| adaptive-hub-additive | 61.49% | 13.32% | 55.36% | 58.68% | 13.10% | 52.11% |

Adaptive BM25 slightly raises hybrid hit rate but lowers precision and recall, so it is not selected. Stronger coverage lowers hybrid hit rate and recall. Both additive variants regress both modes. Those losses remain in the tables and artifacts.

## Category results for the selected defaults

| Mode | Category | Hit before / after | Precision before / after | Recall before / after |
| --- | --- | ---: | ---: | ---: |
| bm25 | multi-hop | 53.24% / 53.60% | 15.83% / 16.76% | 28.58% / 30.42% |
| bm25 | temporal | 69.69% / 69.69% | 14.50% / 14.50% | 66.64% / 66.64% |
| bm25 | open-domain | 38.20% / 39.33% | 8.09% / 8.31% | 28.25% / 29.37% |
| bm25 | single-hop | 67.98% / 68.69% | 13.93% / 14.07% | 66.59% / 67.36% |
| hybrid | multi-hop | 57.91% / 57.91% | 17.70% / 17.70% | 32.39% / 32.39% |
| hybrid | temporal | 72.81% / 72.81% | 15.25% / 15.25% | 69.51% / 69.51% |
| hybrid | open-domain | 40.45% / 40.45% | 8.54% / 8.54% | 29.65% / 29.65% |
| hybrid | single-hop | 69.64% / 69.64% | 14.29% / 14.29% | 68.29% / 68.29% |

## Lost and gained hits for every ranking variant

Each cell is **lost / gained** against the corresponding main baseline. Partial evidence losses, including questions whose hit remains true, are retained in [regressions.json.gz](measured/retrieval-gaps/regressions.json.gz). That archive includes question IDs, before/after retrieved IDs, evidence hits, precision and recall.

| Mode | Variant | Multi-hop | Temporal | Open-domain | Single-hop |
| --- | --- | ---: | ---: | ---: | ---: |
| bm25 | legacy | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| bm25 | entity-coverage | 3 / 4 | 0 / 0 | 0 / 1 | 4 / 10 |
| bm25 | adaptive-bm25 | 1 / 0 | 1 / 1 | 0 / 0 | 2 / 1 |
| bm25 | hub-additive | 16 / 0 | 3 / 3 | 0 / 0 | 16 / 0 |
| bm25 | adaptive-hub-additive | 18 / 0 | 3 / 3 | 0 / 0 | 19 / 0 |
| bm25 | shipping | 3 / 4 | 0 / 0 | 0 / 1 | 4 / 10 |
| hybrid | legacy | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| hybrid | entity-coverage | 2 / 2 | 1 / 0 | 1 / 1 | 4 / 2 |
| hybrid | adaptive-bm25 | 4 / 3 | 3 / 1 | 0 / 1 | 10 / 13 |
| hybrid | hub-additive | 16 / 10 | 23 / 5 | 5 / 3 | 95 / 9 |
| hybrid | adaptive-hub-additive | 18 / 6 | 22 / 5 | 6 / 3 | 92 / 5 |
| hybrid | shipping | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

## Temporal category before and after

All 320 temporal questions remain scored. With the original pinned timestamps, temporal-only retrieval changes no returned IDs in either mode. The coverage-plus-temporal combination likewise has no extra temporal gain. Production-date tests separately verify current-state freshness, past date ranges, superseded history, explicit overrides and dense visibility. No realistic timestamp improvement is claimed from this fixed-clock corpus.

| Mode | Temporal setting | Hit before / after | Precision before / after | Recall before / after | Lost / gained hits |
| --- | --- | ---: | ---: | ---: | ---: |
| bm25 | on, coverage off | 69.69% / 69.69% | 14.50% / 14.50% | 66.64% / 66.64% | 0 / 0 |
| hybrid | on, coverage off | 72.81% / 72.81% | 15.25% / 15.25% | 69.51% / 69.51% | 0 / 0 |

## Preliminary implementation correction

The preliminary entity implementation incorrectly capped scores as well as extra candidate admission at 50 rows. A synthetic test now requires all existing lexical/dense candidates to retain their entity scores; only admission is capped. The initial BM25 entity and combined runs scored 61.95% hit, 13.46% precision and 55.50% recall, losing 52 prior hits and gaining 22. They are retained as `preliminary-entity.json.gz` and `preliminary-combined.json.gz`. This was a correctness fix, not a weight change. A separate dated fixture also required neutralizing inactivity importance decay for historical queries. The final matrix uses the corrected implementation.

## Measured tool text tokens

Actual responses were serialized exactly as MCP text with `JSON.stringify(result, null, 2)` and counted with `cl100k_base`, across all 1,527 questions. Every index had five rows. IDs were checked against ordinary retrieval. Detail selection always uses the first ranked ID, never the annotated evidence. The timeline limit is five. Tool descriptions, requests, transport envelopes and model-specific hidden overhead are excluded.

| Response pattern | Mean tokens | Total tokens | Change vs existing retrieve |
| --- | ---: | ---: | ---: |
| Existing retrieve response | 2613.02 | 3,990,078 | 0.00% |
| Five direct full-detail responses | 1568.95 | 2,395,783 | -39.96% |
| Index only | 520.68 | 795,081 | -80.07% |
| Index + first full detail | 841.00 | 1,284,214 | -67.81% |
| Index + timeline + first full detail | 1336.33 | 2,040,578 | -48.86% |
| Index + all five full details | 2089.63 | 3,190,864 | -20.03% |

Progressive disclosure saves tokens when only selected details are needed. Fetching all five details after the index adds index overhead versus five direct detail calls. The existing retrieve response also includes duplicated normalized content, score metadata and startup formatting, so its larger cost should not be mistaken for the cost of bodies alone. Full per-question counts are in [disclosure.json.gz](measured/retrieval-gaps/disclosure.json.gz).

## Mem0 comparison scope

The existing pinned, unmodified Mem0 OSS raw-turn FAISS result in [mem0-faiss.json.gz](measured/mem0-faiss.json.gz) has 42.63% hit, 9.21% precision and 37.22% recall on these same annotated questions. The selected BM25 default scores 64.44%, 14.32%, 58.27% for those metrics; optional MiniLM scores 66.47%, 14.77%, 59.76%. The Mem0 result was measured in the prior pinned comparison and was not rerun here. It uses `infer=False`, local MiniLM and FAISS, without generated extraction or a keyword backend. This establishes a component comparison, not a claim of beating the complete Mem0 entity pipeline, graph extraction or managed platform. The new matrix evaluates independent source-informed hypotheses within sessionmem; it does not relabel them as Mem0 production scores.

## Automatic memory flow

The [host audit and CI evidence](../docs/automatic-memory.md) document exactly what install configures. Claude Code gains UserPromptSubmit recall and startup catch-up. Codex/Cursor retain automatic watcher capture and gain explicit compact-search instructions; new MCP connections catch up transcripts. Other hosts use instructed saves where supported. Doctor checks current guidance, wiring, watcher health, capture mode and recall mode, and flags unverified Antigravity/QCoder paths. Configuration is not proof that a model executed instructions. CI simulates agent actions and the OS supervisor while exercising real storage, import, hooks, MCP and injection.

## Reproduction and artifacts

Build with the lockfile dependencies, then run:

```bash
npm run build
npm run benchmark -- --no-entity-links --output benchmarks/results/control.json
npm run benchmark -- --output benchmarks/results/default.json
npm run benchmark -- --semantic --output benchmarks/results/hybrid.json
node scripts/benchmark-ranking-matrix.mjs --output-dir benchmarks/results/matrix-bm25
node scripts/benchmark-ranking-matrix.mjs --semantic --output-dir benchmarks/results/matrix-hybrid
npm run benchmark -- --no-entity-links --temporal
node scripts/benchmark-disclosure.mjs --output benchmarks/results/disclosure.json
node scripts/compare-retrieval.mjs --before before.json --after after.json --require-no-regression
npm test -- tests/integration/cli/automatic-memory-flow.spec.ts
```

The [manifest](measured/retrieval-gaps/run-manifest.json) records commands, checksums and the evaluated source/build digest. `source_commit` records the base commit for working-tree evaluations. The [summary](measured/retrieval-gaps/summary.json) and compressed complete runs retain every category and question. Timing fields are retained, but runs overlapped with tests and other evaluations; no latency comparison is claimed. All runners recorded zero external network attempts. Unavailable-model fallback IDs exactly match the new default.

LoCoMo attribution and CC BY-NC 4.0 terms remain in [provenance](README.md#data-provenance-and-license) and [the dataset license](data/LICENSE.txt). The repository MIT license does not relicense the dataset annotations. Public README and explicitly requested Mem0 source references are recorded separately; no competitor code or prompt was adapted.


## Validation

Build, typecheck and lint pass. The quiet full suite passed 788 tests in 126 files.
The final doctor guards passed three focused cases; adapter permissions passed six
focused cases. An initial suite run overlapped with evaluations and hit seven
CLI harness timeouts. Timeouts were not relaxed, and the quiet rerun passed.
The CI workflow now explicitly runs the install-to-new-session test in its OS
matrix. Remote CI results are separate from local validation.
