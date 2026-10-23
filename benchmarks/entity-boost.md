# Bounded entity boost evaluation

The optional `entityBoost` adds up to 0.10 to the existing relevance score,
capped at 1, before optional temporal fusion. The relevance weight of 0.60 makes
the final ranking increase at most 0.06. Captured entity names and explicit
aliases supply the signal. Relevance, recency, importance and the compact
index/timeline/details flow remain in place. No runtime dependencies were added.

The baseline is main at `646c8a1`, including its default entity-link coverage.
The candidate changes only `entityBoost` to true. Both use the existing offline
LoCoMo harness, the committed corpus checksum, pinned capture/query clock
`2026-01-01T00:00:00.000Z`, default BM25 ranking, five results per question and
on-demand retrieval. All 5,882 turns across 272 sessions and 10 conversations
are captured normally. The harness scores 1,527 questions and excludes 459
under its existing rules. Neither run attempts network access.

| Macro metric @5 | Main baseline | Boost enabled |
| --- | ---: | ---: |
| Hit rate | 64.4401% (984/1,527) | 64.5056% (985/1,527) |
| Precision | 14.3157% | 14.3026% |
| Recall | 58.2705% | 58.1068% |
| All-evidence rate | 53.1107% | 52.8487% |

The candidate gains seven hits and loses six. Four gains are multi-hop; three
gains and all six losses are single-hop. Temporal and open-domain hit counts
are unchanged. The complete aggregate comparison and affected question/evidence
IDs are in [the measured artifact](measured/entity-boost.json).

`entityBoost` defaults off. Its hit rate improves by one question, but precision
and recall decline, so it fails the harness's existing three-metric regression
gate. Default retrieval retains the baseline ranking. The setting is independent
of the earlier `entityLinkBoost` coverage/fusion option, whose defaults are
unchanged. Enable the positive boost with
`sessionmem config set entityBoost true`, or disable it with the same command
and `false`.

Reproduce with the supported Node version and installed dependencies:

```bash
npm run build
npm run benchmark -- --no-entity-boost --output benchmarks/results/boost-before.json
npm run benchmark -- --entity-boost --output benchmarks/results/boost-after.json
node scripts/compare-retrieval.mjs --before benchmarks/results/boost-before.json --after benchmarks/results/boost-after.json --output benchmarks/results/boost-comparison.json
```

Adding `--require-no-regression` to the comparison rejects this candidate for
lower precision. It checks hit rate, precision and recall separately.

Limits: this is annotated turn retrieval, not answer accuracy or a coding-session
evaluation. Equal timestamps do not measure time decay; tests separately exercise
recent unmatched chunks and temporal fusion. The boost depends on existing
deterministic extraction and explicit aliases (`postgres`/`postgresql`,
`node`/`node.js`, `k8s`/`kubernetes`). Query matching considers spans of up to eight
tokens starting within the first 64 tokens. It does not infer pronouns, fuzzy
names or arbitrary aliases. Candidate admission is capped at 50 entity IDs, and
high relevance scores can saturate at 1 without receiving an extra boost.
Optional learned semantic ranking was not evaluated for this change. The default
there also remains unchanged. The one-question aggregate hit improvement does
not establish a general retrieval gain, and the six lost hits remain losses.
