# Conversational retrieval benchmark

`npm run benchmark` runs the committed LoCoMo corpus through the public
`storeMemory` capture and `retrieveMemories` recall APIs. See
[benchmarks/README.md](../benchmarks/README.md) for the corpus license, selection
rules, metric definitions, and detailed reproduction instructions.

## Entity overlap comparison

The baseline was run first on current main at `81f987c`. A fixed 10% entity
contribution inside the existing relevance component was then evaluated without
a weight sweep. Both runs used Node v24.19.0, Linux x64, sessionmem 1.4.0, the
same installed lockfile dependencies, top-5, fixed clocks, and the unchanged
LoCoMo corpus and scoring rules. Each run scored 1,527 questions after capturing
5,882 turns; both recorded zero network attempts.

| Macro retrieval metric @5 | Main (BM25) | BM25 + entity overlap |
| --- | ---: | ---: |
| Hit rate | 61.95% | 63.92% |
| Precision | 13.45% | 14.05% |
| Recall | 55.96% | 57.45% |
| All-evidence rate | 51.15% | 52.26% |

| Recall latency | Main | Entity overlap |
| --- | ---: | ---: |
| Mean | 8.57 ms | 8.05 ms |
| Median | 7.27 ms | 7.58 ms |
| p95 | 21.04 ms | 14.94 ms |
| Maximum | 35.81 ms | 28.38 ms |

Entity overlap gained hits on 34 questions and lost hits on four, a net gain
of 30. Precision and recall increased on 48 questions and decreased on five.
The signal measurably improved retrieval on this corpus, so it is retained.
Timing is one call per question without warmup and varies with load; the lower
mean/p95 is not evidence that the added lookup makes retrieval faster. This
does not establish generalization to other corpora or measure extraction accuracy.
The rule vocabulary and fixed weight were not tuned against these results.

[Recorded aggregate results](../benchmarks/entity-overlap-results.json) include
the corpus checksum, shared configuration, runtime, category metrics, and paired
question counts. To reproduce, run the commands below on `81f987c` with output
`benchmarks/results/locomo-main.json`, then on this change with output
`benchmarks/results/locomo-entities.json`. Full per-question reports remain ignored
local artifacts.

## Earlier BM25 comparison

The baseline was run first on main at `c06857d`, before changing retrieval.
Both runs used sessionmem 1.4.0, Node v24.19.0, Linux x64, top-5,
and the same lockfile dependencies and fixed capture/retrieval clock.
They captured 5,882 turns across 272 sessions in 10 conversations and scored
1,527 questions. The same 446 adversarial, four missing-evidence, and nine
invalid-evidence questions were excluded by fixed annotation rules.

| Macro retrieval metric @5 | Main (hash ranking) | BM25 + stop words + stemming |
| --- | ---: | ---: |
| Hit rate | 1.44% | 61.95% |
| Precision | 0.29% | 13.45% |
| Recall | 0.88% | 55.96% |
| All-evidence rate | 0.65% | 51.15% |

| Recall latency | Main | Selected change |
| --- | ---: | ---: |
| Mean | 16.33 ms | 14.93 ms |
| Median | 15.22 ms | 13.52 ms |
| p95 | 28.80 ms | 28.81 ms |
| Maximum | 133.49 ms | 56.73 ms |

Latency includes the complete public service response, including startup-injection
formatting, and excludes capture, process startup, and corpus loading. Each query
is timed once without warmup. Timing depends on hardware and load.

| Question category | Questions | Hit rate | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| Multi-hop | 278 | 46.76% | 13.60% | 25.06% |
| Temporal | 320 | 69.38% | 14.38% | 66.22% |
| Open-domain | 89 | 38.20% | 8.09% | 28.25% |
| Single-hop | 840 | 66.67% | 13.62% | 65.22% |

## Candidate comparisons

Each candidate was run with the existing offline evaluator on the same questions.
Only additions that increased hit rate, precision, and recall were retained.

| Candidate @5 | Hit rate | Precision | Recall |
| --- | ---: | ---: | ---: |
| BM25 with OR terms | 52.78% | 11.15% | 47.69% |
| + English stop-word filtering | 57.69% | 12.39% | 52.62% |
| + Porter stemming (selected) | 61.95% | 13.45% | 55.96% |
| 90% BM25 / 10% hash cosine (discarded) | 61.76% | 13.43% | 55.78% |

BM25 preserves lexical relevance instead of replacing it with hash-vector noise.
Common question words no longer require a literal match, and SQLite's built-in
Porter tokenizer matches English inflections. The existing recency, importance,
expiry, project scope, and no-match vector fallback remain in place. There are
no new dependencies, API keys, or model downloads. Migration 013 rebuilds the
existing FTS index; memory content and IDs are preserved.

These comparisons use the same corpus used to select the ranker; they are not
a held-out generalization estimate. BM25 still needs lexical overlap, and a hit
can leave evidence missing for multi-hop questions. These are annotated-evidence
retrieval scores, not answer-generation accuracy or summarization quality.

## Reproduce

After installing the lockfile dependencies, run on main to record the baseline,
then repeat on the change:

```bash
npm run build
npm run benchmark -- --output benchmarks/results/locomo.json
```

The corpus is pinned to upstream commit
`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`, SHA-256
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.
The runner verifies this checksum and blocks network calls. No API keys are
required. A second full run with an empty environment produced identical
retrieved IDs and quality metrics for all 1,527 questions. JSON output includes
every scored question, answer, evidence list, returned IDs, and exclusion reason
so failures can be inspected. The report above is a recorded result; the command
prints current results and writes JSON only when requested.
