# Scopes retrieval evaluation

The existing offline LoCoMo harness was run before and after the scope change,
with no scope argument. The baseline is main at
`869ce6e3d7076cf7bcda4d84a36aa4af76aac27d`, including the merged entity boost.
Both runs use five results, on-demand retrieval, the normal default ranking,
the committed corpus checksum and the pinned clock
`2026-01-01T00:00:00.000Z`.

| Macro metric @5 | Before | After |
| --- | ---: | ---: |
| Hit rate | 64.4401% (984/1,527) | 64.4401% (984/1,527) |
| Precision | 14.3157% | 14.3157% |
| Recall | 58.2705% | 58.2705% |
| All-evidence rate | 53.1107% | 53.1107% |

All 1,527 scored questions have identical retrieved ID sequences. There are no
lost or gained hits, no lost evidence and no category-level metric changes. The
existing three-metric no-regression gate passes. Both runs captured 5,882 turns
across 272 sessions and 10 conversations and recorded zero network attempts.
The harness's existing rules exclude 459 questions.

A separate regression fixture records ten full serialized response checksums
from main across 90 memories. Full retrieval and compact search still match
these bytes after assigning mixed labels. Scope behavior is tested separately:
filters precede candidate limits, boosts are bounded, recent unmatched records
can win, local dense/entity/alias channels respect filters, and scoped timeline
and detail reads preserve visibility. Capture and real-file migration tests
cover automatic labels, explicit overrides and upgrade safety.

Reproduce the default compatibility run with installed dependencies:

```bash
npm run build
npm run benchmark -- --output benchmarks/results/scopes-after.json
node scripts/compare-retrieval.mjs --before before.json --after benchmarks/results/scopes-after.json --require-no-regression
```

Run the baseline command on the pinned main commit before applying this change.
The [measured artifact](measured/scopes.json) records both configurations,
metrics, comparison results and source/fixture checksums.

Limits: this is annotated turn retrieval, not generated-answer quality or a
coding-session benchmark. LoCoMo has no scope relevance labels, so this run
establishes unchanged default behavior rather than a quality gain for scoped
queries. Equal timestamps do not measure time decay. Learned semantic retrieval
was not re-evaluated; a deterministic local test provider verifies its scope
filtering and candidate limits. Scope boost only reranks existing candidates and
can saturate at relevance 1. Directory-derived labels can collide or change;
explicit labels are available. Historical rows remain unlabelled after upgrade.
