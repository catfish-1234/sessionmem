# Retrieval source notes

The initial review used only public READMEs. The follow-up explicitly requested
inspection of Mem0's scoring and entity-link source. No competitor implementation
or prompt was copied or adapted. The implementation is independent; mathematical
hypotheses and API names identify the approaches being evaluated.

## Public documentation

The [reference manifest](measured/retrieval-gaps/public-docs.json) pins README
commits and checksums for claude-mem, Mem0 and Graphiti, plus their Apache-2.0
license references. No README prose is redistributed in the implementation.

- claude-mem documents compact search, chronological inspection and selected full
  details. This motivates progressive disclosure, rather than always returning
  all full records.
- Mem0 documents entity links and multi-signal retrieval. This motivates an
  entity candidate channel and explicit fusion with BM25 and optional semantics.
- Graphiti documents temporal validity and preserved history. This motivates
  deterministic current/past intent and use of existing supersession records.

These are observations about documented approaches, not quality claims or proof
that sessionmem implements the same pipelines.

## Requested Mem0 source hypotheses

Sources at `0724291bd864cf807e88ee8981c8226644e8fb42`:

- [scoring utilities](https://github.com/mem0ai/mem0/blob/0724291bd864cf807e88ee8981c8226644e8fb42/mem0/utils/scoring.py)
- [entity boost computation](https://github.com/mem0ai/mem0/blob/0724291bd864cf807e88ee8981c8226644e8fb42/mem0/memory/main.py)
- [Apache-2.0 license](https://github.com/mem0ai/mem0/blob/0724291bd864cf807e88ee8981c8226644e8fb42/LICENSE)

The requested hypotheses were fixed before their evaluation:

| Meaningful query terms | Sigmoid midpoint | Steepness |
| --- | ---: | ---: |
| Up to 3 | 5 | 0.7 |
| Up to 6 | 7 | 0.6 |
| Up to 9 | 9 | 0.5 |
| Up to 15 | 10 | 0.5 |
| More than 15 | 12 | 0.5 |

`adaptive-bm25` applies that sigmoid to positive SQLite FTS5 BM25 values. Query
length uses sessionmem's existing normalized lexical terms, rather than Mem0's
lemmatizer. A zero lexical score stays zero. SQLite's BM25 scale and candidate
pool differ from other backends, so success is measured rather than assumed.

`hub-additive` keeps the existing per-query BM25 maximum normalization and adds
hub-damped entity links and optional MiniLM. `adaptive-hub-additive` also switches
to the adaptive sigmoid. Both normalize by the maximum possible sum of active
channels: 1 for lexical, 1 for dense and 0.5 for entity links. With dense retrieval
active, the fixed semantic gate is 0.2 before fusion. A lexical candidate absent
from the dense pool does not pass that gate. This gate is a stated local
hypothesis, not a claim about Mem0's default caller threshold.

For hub damping, up to eight linked stored names are considered, preferring longer
literal spans with deterministic ties. Exact and explicit alias matches have
similarity 1. Each entity contributes `0.5 / (1 + 0.001 * (degree - 1)^2)` and each
memory receives the maximum contribution, not their sum. Visibility filtering
precedes degree counts. Sessionmem does not embed query entities or implement
Mem0's entity-store similarity search. This tests the damping and fusion ideas
within the existing extractor tables, not the complete Mem0 entity pipeline.

The original entity-coverage hypothesis uses rare-name weighted coverage and an
80:20 blend with existing relevance. Its preliminary score-cap bug and corrected
results are both retained. No weights were swept, no query or category special
cases were introduced, and no evidence labels or answers enter ranking. Only
whole-mode default selection uses the measured regression gate.

See [all results and losses](retrieval-gaps.md). LoCoMo annotations retain their
separate CC BY-NC 4.0 terms; sessionmem remains MIT.
