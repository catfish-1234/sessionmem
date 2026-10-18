# Conversational memory evaluation

This benchmark measures retrieval of annotated evidence from the committed
[LoCoMo](https://github.com/snap-research/locomo) release. It replaces the ten
queries that copied stored memory text. The corpus has 10 conversations,
272 chronological sessions, 5,882 dialogue turns, and 1,986 question annotations.
Every run uses the same data; there is no generation, downloading, or model judge.

## Run

Use the Node version supported by `package.json`. Install dependencies once with
`npm ci` (or provision them from an offline package cache), then:

```bash
npm run build
npm run benchmark
npm run benchmark -- --output benchmarks/results/locomo.json
npm run benchmark -- --top-k 10 --output benchmarks/results/locomo-k10.json
```

The build and evaluation work without network access or API keys after dependencies
are installed. No model weights or additional dependencies are downloaded. The
runner blocks HTTP, fetch, TCP/TLS, UDP, and DNS access before loading sessionmem.
Any attempted network access fails the run, even if a fallback catches the error.
Results are printed to stdout; `--output` additionally writes per-question JSON.
`benchmarks/results/` is ignored by Git. API errors, bad options, and checksum
mismatches produce a nonzero exit status; low retrieval scores are valid results.

## Capture and recall

The runner uses the public `createMemoryCoreService` methods used by MCP tools:

1. Create a fresh in-memory database for each conversation, with its own project
   ID and an isolated temporary config. The user's database and config are unused.
2. Capture every dialogue turn using `storeMemory`, keeping the original session
   boundaries. Memory content contains only the session date string, speaker,
   dialogue text, and supplied image caption if present. Images are never fetched.
   All turns are captured as `fact`, importance 5, with production redaction enabled.
3. After capturing the whole conversation, pass each eligible original question
   unchanged to `retrieveMemories`, with `limit=5` by default, `depth=default`, and
   `mode=on-demand`. This mode avoids access-count boosts from earlier questions.
4. Compare returned memory IDs to the question's annotated dialogue IDs. IDs are
   namespaced by conversation, so identical upstream turn IDs cannot collide.

Questions, answers, generated observations, and supplied session/event summaries
never enter memory. Evidence IDs are metadata, not searchable memory content.
The corpus contains these fields because the upstream file is preserved intact.

This is a turn-level capture/retrieval evaluation. It does not measure automatic
memory extraction, session-end summarization, answer generation, or the smaller
token-budgeted startup injection. Recall latency includes the full public service
call, including its normal startup-injection formatting, but evidence is scored
against returned `memories`, not that formatted string.

Capture timestamps and retrieval time are both pinned to
`2026-01-01T00:00:00.000Z`. All turns therefore have equal recency regardless of
ingestion order. Original conversation dates remain in the text for temporal
questions. Retention is disabled; this benchmark does not test time decay.
The production BM25 candidate/ranking code runs unchanged. The hash-based
`deterministicEmbed` remains a diagnostic and no-match fallback. No semantic model
or answer-aware ranking is substituted.

## Metrics

For each scored question, let **E** be its unique annotated evidence turn IDs and
**R** the unique returned IDs (at most `k`). Let **H** be their intersection.

| Metric | Per-question definition | Interpretation |
| --- | --- | --- |
| Hit rate @k | 1 if H is nonempty, otherwise 0 | At least one evidence turn was found |
| Precision @k | `len(H) / len(R)`, or 0 for no results | Fraction of returned turns annotated as relevant |
| Recall @k | `len(H) / len(E)` | Fraction of the required evidence retrieved |
| All-evidence rate @k | 1 if H equals E, otherwise 0 | All annotated evidence was found |

Overall and category scores are **macro averages over questions**; every question
has equal weight. Precision divides by the actual number returned, not padded
slots. Recall keeps the complete evidence denominator even if there are more
than `k` evidence turns. For example, finding one of two required turns among five
results yields a hit, precision 20%, recall 50%, and all-evidence score 0.

Multi-hop questions can have a hit while missing most evidence. Read recall and
all-evidence rate alongside hit rate. Evidence annotations may be incomplete:
an unannotated turn receives no credit even if it supplies similar information.
These are retrieval metrics, not generated-answer accuracy or official LoCoMo
question-answering scores. Ground-truth answers remain available in the JSON to
inspect failures; answers are not used as substring matches or retrieval queries.

Latency uses `performance.now()` around each awaited `retrieveMemories` call.
The runner reports mean, median, nearest-rank p95, and maximum in milliseconds.
Every query is measured once in source order, including the first call; there is
no warmup or repetition. Capture time is reported separately per conversation in
JSON. Latencies vary with hardware and load and are not deterministic.

## Coverage and exclusions

The runner scores 1,527 questions in categories 1–4: multi-hop, temporal,
open-domain, and single-hop. It reports all 459 excluded questions and reasons:

| Reason | Questions | Handling |
| --- | ---: | --- |
| Adversarial (category 5) | 446 | These contain misleading `adversarial_answer` annotations, not positive answer evidence; retrieval alone cannot score abstention |
| Missing evidence | 4 | No turn-level relevance labels are available |
| Invalid evidence | 9 | At least one reference does not exactly identify a turn; exclude the entire question |

Evidence labels are not repaired or partially dropped. The selection rule depends
only on annotations, never on sessionmem's results. Questions excluded from scoring
remain committed and appear in `excluded_questions`. The JSON also records corpus
checksum, configuration, runtime, category/conversation aggregates, original
questions and answers, full evidence lists, returned IDs, hits, and timings.

To compare runs, use the same checkout, lockfile-installed dependencies, and `k`.
Check the corpus checksum and configuration first. Quality scores and retrieved
IDs should match across repeated runs; timing fields and runtime metadata can vary.
`npm test -- tests/unit/benchmarks tests/integration/benchmarks` verifies scoring,
corpus integrity, leakage boundaries, offline enforcement, and the public API path.

## Data provenance and license

[data/locomo10.json](data/locomo10.json) is an unmodified copy of
`snap-research/locomo/data/locomo10.json` at commit
[`3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376`](https://github.com/snap-research/locomo/tree/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376).
[data/provenance.json](data/provenance.json) records the source Git blob and SHA-256
checksums. The runner verifies the corpus checksum before evaluating.

LoCoMo is by Adyasha Maharana, Dong-Ho Lee, Sergey Tulyakov, Mohit Bansal,
Francesco Barbieri, and Yuwei Fang, accompanying *Evaluating Very Long-Term
Conversational Memory of LLM Agents* (ACL 2024),
[arXiv:2402.17753](https://arxiv.org/abs/2402.17753).

The dataset is distributed separately under **CC BY-NC 4.0**, which permits
redistribution with attribution for noncommercial purposes. The complete upstream
license, including its warranty disclaimer, is preserved in
[data/LICENSE.txt](data/LICENSE.txt). The repository's MIT license does not
relicense this third-party dataset. No endorsement by the dataset authors is implied.
LoCoMo's conversations were generated and annotated as described in the paper;
they are not a sample of sessionmem users or coding-agent workloads.
