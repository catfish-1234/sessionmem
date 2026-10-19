# Measured local memory retrieval comparison

Main was evaluated before source changes. This PR then measured local retrieval
components from claude-mem, Mem0 OSS, Graphiti, and cognee on the same committed
LoCoMo corpus. It adds optional local MiniLM candidates to sessionmem's FTS5
ranker. Every number below comes from an archived run here; no vendor benchmark
numbers are included.

These are **raw-turn retrieval configurations**, not end-to-end product scores.
Generated observations, fact extraction, temporal graph construction, automatic
capture selection, contradiction accuracy, and answer generation are unmeasured.
In particular, the Graphiti episode and cognee chunk rows do not measure their
full graph retrievers. The pinned [actual-source review](benchmarks/source-review.md)
covers capture, ranking, contradictions, and sessionmem's remaining gaps.

## Same corpus and metrics

All configurations ingest the same 5,882 dialogue turns from 272 sessions in
10 conversations. They receive the same 1,527 original eligible questions from
1,986 annotations. Fixed rules exclude 446 adversarial, four missing-evidence,
and nine invalid-evidence questions. No question, answer, evidence ID, or supplied
summary enters searchable memory. Capture uses the same production redaction;
turn IDs are mapped outside the text. Conversation stores are isolated.

The shared scorer uses at most five unique retrieved turns: hit means any
annotated evidence found; precision divides by the actual returned count; recall
divides by all annotated evidence, even when there are more than five evidence
turns. Scores are macro averages over questions. Corpus SHA-256 is
`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.
See [methodology and dataset attribution](benchmarks/README.md) and
[environment, dependencies, and adapter boundaries](benchmarks/REPRODUCE.md).

## Measured results

Percentages are quality metrics @5; latency is milliseconds per retrieval call.
Every row links its complete per-question JSON, compressed losslessly with gzip.

| Measured configuration | Hit % | Precision % | Recall % | Mean ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Main, before changes](benchmarks/measured/main.json.gz) | 63.92 | 14.05 | 57.45 | 13.44 | 24.43 |
| [Main, quiet repeat](benchmarks/measured/main-final.json.gz) | 63.92 | 14.05 | 57.45 | 14.59 | 26.27 |
| [claude-mem SQLite observations](benchmarks/measured/claude-sqlite.json.gz) | 51.08 | 10.83 | 46.26 | 1.99 | 2.79 |
| [claude-mem Chroma observations](benchmarks/measured/claude-chroma.json.gz) | 42.63 | 9.21 | 37.22 | 303.52 | 337.81 |
| [Mem0 OSS, raw / MiniLM / FAISS](benchmarks/measured/mem0-faiss.json.gz) | 42.63 | 9.21 | 37.22 | 23.42 | 30.12 |
| [Graphiti, raw episodes / BM25 / RRF](benchmarks/measured/graphiti-episodes.json.gz) | 19.12 | 3.97 | 16.52 | 2.14 | 2.77 |
| [cognee, raw chunks / MiniLM / LanceDB](benchmarks/measured/cognee-chunks.json.gz) | 42.63 | 9.21 | 37.22 | 30.02 | 37.13 |
| [sessionmem, optional MiniLM hybrid](benchmarks/measured/hybrid-final.json.gz) | 66.47 | 14.77 | 59.76 | 26.10 | 36.96 |
| [sessionmem, enabled but unavailable model](benchmarks/measured/fallback.json.gz) | 63.92 | 14.05 | 57.45 | 14.81 | 27.02 |

The final main/hybrid/fallback runs and repeated competitors ran sequentially,
without concurrent tests or benchmarks. The original before-change main run is
retained separately. It used the workspace's preprovisioned dependencies; the
quiet main and final hybrid used the same lockfile-normalized dependency tree.
Main's retrieved IDs and scores stayed identical. Compare the quiet pair for
latency. All-evidence rates, category breakdowns, capture times,
model loading, and paired question changes are in
[summary.json](benchmarks/measured/summary.json) and the full reports.

Latency covers different public/component boundaries: sessionmem includes its
normal injection formatting; Mem0 includes SDK processing; claude-mem Chroma
includes MCP IPC; Graphiti and cognee time their named retrieval components.
Model startup and index construction precede query timing and have additional
cost. Final hybrid model loading took 372.20 ms and capture/indexing of all
5,882 turns took 58.84 s, versus 2.66 s for quiet main capture. An existing store's
first semantic query can additionally backfill vectors; that cold-query scenario
was not timed here. There is no warmup; the first query is included. Mem0's first
query can include spaCy initialization. Chroma's encoder uses fixed 256-token padding.
Linux x64, two-CPU quota, 8 GiB RAM, single inference thread; these single passes
do not establish statistical significance or production throughput.

## What changed and what regressed

Main had higher aggregate quality than these measured competitor configurations.
The largest measured coverage gap was in the local MiniLM variants: Mem0's dense
configuration found evidence for 120 questions that main missed, while losing
445 main hits. SQLite recovered 48 misses and Graphiti episodes recovered 26.
This supports adding learned candidates alongside lexical retrieval. The faster
SQLite/episode rows also expose a latency gap; this change does not close that gap.
The raw configurations also differ in ranking and supersession behavior, so
paired coverage alone does not attribute every baseline miss to lexical matching.

The final hybrid recovers 72 main misses and loses 33 main hits, a net 39 hits.
Recall improves on 93 questions and regresses on 42. Aggregate hit rate rises
63.92% → 66.47%, precision 14.05% → 14.77%, recall 57.45% → 59.76%.
All 42 recall regressions, including lost-hit questions, are visible in
[regressions.json](benchmarks/measured/regressions.json). For example, the hybrid
loses the evidence for "When did Melanie go camping in July?" (`conv-26/q36`).

The quiet mean latency rises 14.59 → 26.10 ms. The feature therefore defaults off.
Its quality gain is modest and costs inference time. The unavailable-model run
returns exactly the same IDs and quality as main across all 1,527 questions.
This corpus was already used to develop main's ranker and is not a held-out test
or evidence of coding-session quality. No weighting sweep or answer-based tuning
was done here; the fixed lexical:dense blend is 2:1.

Implementation: pinned all-MiniLM-L6-v2, 384 dimensions, mean pooling, L2
normalization, 256-token limit; SHA-256 checked local package files. Separate
versioned SQLite BLOB vectors, exact cosine top-50 candidates unioned with FTS,
then the existing entity/recency/importance scoring. Capture embeds stored text
after configured redaction; edits invalidate vectors and deletes cascade. Older/imported rows
backfill on retrieval. Scope, expiry and supersession filters apply before dense
selection. Missing packages or failed inference preserve BM25 behavior. Linear
scans and first-query backfill limit scale. See [setup](docs/local-semantic.md).

## Locally measured boundaries and unmeasured pipelines

| Project | What ran here | What remains unmeasured and why |
| --- | --- | --- |
| claude-mem | Upstream observation store + SQLite search; separately its ChromaSync/SearchOrchestrator with actual local chroma-mcp | AI observation/session-summary generation. No configured local generative model/server; hosted defaults need credentials. Source supports local OpenAI-compatible providers, so it does not universally require an Anthropic key |
| Mem0 OSS | Public add(infer=False) / search, local MiniLM, cosine FAISS, spaCy, no reranker | infer=True LLM extraction and entity linking. No local generative model/server available; Ollama registry and HF model access were blocked. The configured Ollama LLM is unused by infer=False. FAISS has no keyword channel; this does not measure Qdrant BM25, optional rerankers, or Platform |
| Graphiti | Native EpisodicNode save / episode_search BM25 + RRF on embedded FalkorDB Lite | add_episode extraction/resolution, semantic entity/edge search, BFS and temporal invalidation. Default construction fails for absent OpenAI credentials; an alternative local LLM requires weights/server unavailable here. Separate process/database per conversation supplies scope; group_ids=None avoids the optional full-text filter's empty results on hyphenated IDs found in a setup probe |
| cognee | Native DocumentChunk/add_data_points/ChunksRetriever on local Turso + LanceDB with MiniLM | cognify and hybrid/temporal graph retrieval, summaries, memify conflict review. Default keyless GLiNER requires absent gliner2/torch and fastino/gliner2.5-base-v1 weights; the weight URL was blocked with HTTP 403. Auto-install was deliberately disabled in the probe because it could not resolve unavailable weights. Raw chunks need neither GLiNER nor an LLM. Turso avoids the default Ladybug extension bootstrap into a read-only home cache |
| Zep managed | No quality or latency result | Pinned Python SDK requires ZEP_API_KEY and calls the hosted v4 API. It supplies no local server implementation. No account/key/spend was used; separate OSS Graphiti is measured only as above |

The [availability probe](benchmarks/measured/availability.json) records actual
credential/runtime errors and blocked GLiNER/Ollama URLs. Its exact command and
harness/source commits are in that artifact. These restrictions describe this
environment; they are not claims that the OSS pipelines cannot run locally.
No paid keys, remote model completions, model judge, or hosted memory API were used.

## Native runtime network check

Final sessionmem sets `ORT_DISABLE_TELEMETRY=1` before loading ONNX Runtime.
Source review found that ORT 1.30's POSIX telemetry can use native HTTP outside
JavaScript network guards. A fresh Linux strace of model loading and one embedding
showed zero network system calls; the exact command, commit, trace and scope are
in [native-offline.json](benchmarks/measured/native-offline.json). This is a
smoke check, not a native trace of every LoCoMo query. Application network guards
also reject caught network attempts. Final competitor repeats pass the opt-out
to all subprocesses and verify model/tokenizer hashes. Earlier neural runs did
not explicitly set the native opt-out; their application guard counters alone
cannot prove absence of native telemetry traffic. Their measured scores/timings
are preserved below, not relabeled as final runs.

## Earlier runs retained

These are measured diagnostics, not alternative headline results. Initial hybrid
timing overlapped validation; the lockfile-normalized main diagnostic overlapped
other work. The quiet pre-opt-out hybrid has the same retrieval IDs/quality as
the final hybrid. Initial competitor runs preceded the native opt-out repeat.

| Archived run | Hit % | Precision % | Recall % | Mean ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| [hybrid-initial](benchmarks/measured/hybrid-initial.json.gz) | 66.47 | 14.77 | 59.76 | 34.19 | 62.99 |
| [hybrid-before-telemetry-optout](benchmarks/measured/hybrid-before-telemetry-optout.json.gz) | 66.47 | 14.77 | 59.76 | 26.49 | 38.23 |
| [main-lockfile-contended](benchmarks/measured/main-lockfile-contended.json.gz) | 63.92 | 14.05 | 57.45 | 46.69 | 106.88 |
| [claude-sqlite-initial](benchmarks/measured/claude-sqlite-initial.json.gz) | 51.08 | 10.83 | 46.26 | 2.35 | 3.94 |
| [claude-chroma-initial](benchmarks/measured/claude-chroma-initial.json.gz) | 42.63 | 9.21 | 37.22 | 302.99 | 331.14 |
| [mem0-faiss-initial](benchmarks/measured/mem0-faiss-initial.json.gz) | 42.63 | 9.21 | 37.22 | 23.69 | 30.73 |
| [graphiti-episodes-initial](benchmarks/measured/graphiti-episodes-initial.json.gz) | 19.12 | 3.97 | 16.52 | 2.07 | 2.68 |
| [cognee-chunks-initial](benchmarks/measured/cognee-chunks-initial.json.gz) | 42.63 | 9.21 | 37.22 | 30.03 | 37.66 |

## Exact commands and commits

Paths below are the paths used in this workspace. Commands originally wrote
`.json`; the matching archives are `benchmarks/measured/NAME.json.gz`. See
[provisioning](benchmarks/REPRODUCE.md) for pinned clones, packages and weights.
The main repeats ran in `/workspace/work/sessionmem-main`, a detached worktree
at the stated main commit, built with `npm run build`. Its `node_modules`
symlink used the final branch's installed dependencies. Other commands ran in
`/workspace/sessionmem` at the reported source/harness commit. Sessionmem was
built before its evaluations. Reports were archived using `gzip -n`.
The original main runner did not record command/commit fields; those three
unchanged-main runs are recorded in the manifest from their checkout and commands.
Early runners recorded HEAD at completion. The initial hybrid started at
`90ccdf8`; executed source, lockfile and runner are identical at its recorded
`01c9436` commit. Later runners capture commits before execution. Competitor
tracked source trees were checked clean; only local transports/stores were supplied.

**main** — source `c4ebced00784c77d2c926c625a3b196afe560b28`.

```bash
npm run build && npm run benchmark -- --output /workspace/work/locomo-main-before.json
```

**main-final** — source `c4ebced00784c77d2c926c625a3b196afe560b28`.

```bash
npm run benchmark -- --output /workspace/work/locomo-main-final.json
```

**claude-sqlite** — source `b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0`; harness `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
node scripts/compare.mjs --competitor claude-sqlite --source /workspace/work/competitors/claude-mem --bun /workspace/work/tools/node_modules/@oven/bun-linux-x64/bin/bun --output benchmarks/measured/claude-sqlite.json
```

**claude-chroma** — source `b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0`; harness `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
node scripts/compare.mjs --competitor claude-chroma --source /workspace/work/competitors/claude-mem --bun /workspace/work/tools/node_modules/@oven/bun-linux-x64/bin/bun --chroma-python /workspace/work/chroma-venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/claude-chroma.json
```

**mem0-faiss** — source `0724291bd864cf807e88ee8981c8226644e8fb42`; harness `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
node scripts/compare.mjs --competitor mem0 --source /workspace/work/competitors/mem0 --python /workspace/work/venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/mem0-faiss.json
```

**graphiti-episodes** — source `417c3a125ae3ac53c19b8e53fffaccf3e665a88e`; harness `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
node scripts/compare.mjs --competitor graphiti-episodes --source /workspace/work/competitors/graphiti --python /workspace/work/probes-venv/bin/python --output benchmarks/measured/graphiti-episodes.json
```

**cognee-chunks** — source `37f788bd287750e10d7610173e5332b3843f6ebd`; harness `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
node scripts/compare.mjs --competitor cognee-chunks --source /workspace/work/competitors/cognee --python /workspace/work/cognee-venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/cognee-chunks.json
```

**hybrid-final** — source `72920732f79a47d0568757e9d48eaad7e29e61aa`.

```bash
npm run benchmark -- --semantic --output benchmarks/measured/hybrid-final.json
```

**fallback** — source `bfc2777b07cdcda13f8578b5ffcf21f8be79d319`.

```bash
npm run benchmark -- --semantic-unavailable --output benchmarks/measured/fallback.json
```

**hybrid-initial** — source `01c943609d2f127c3561932911d9f6b69549542c`.

```bash
npm run benchmark -- --semantic --output benchmarks/measured/hybrid-initial.json
```

**hybrid-before-telemetry-optout** — source `18cd50c9fe32e15c81dcb853b65bb2266dfaa895`.

```bash
npm run benchmark -- --semantic --output benchmarks/measured/hybrid-final.json
```

**main-lockfile-contended** — source `c4ebced00784c77d2c926c625a3b196afe560b28`.

```bash
npm run benchmark -- --output /workspace/work/locomo-main-lockfile.json
```

**claude-sqlite-initial** — source `b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0`; harness `68533df64518ed22241072cd6fe000d6258adfa6`.

```bash
node scripts/compare.mjs --competitor claude-sqlite --source /workspace/work/competitors/claude-mem --bun /workspace/work/tools/node_modules/@oven/bun-linux-x64/bin/bun --output benchmarks/measured/claude-sqlite.json
```

**claude-chroma-initial** — source `b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0`; harness `894100b68b633a551d18520650fbe1469bf04ee0`.

```bash
node scripts/compare.mjs --competitor claude-chroma --source /workspace/work/competitors/claude-mem --bun /workspace/work/tools/node_modules/@oven/bun-linux-x64/bin/bun --chroma-python /workspace/work/chroma-venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/claude-chroma.json
```

**mem0-faiss-initial** — source `0724291bd864cf807e88ee8981c8226644e8fb42`; harness `3b26b6184c1196cb8ec60c6d6ee84a794d42665a`.

```bash
node scripts/compare.mjs --competitor mem0 --source /workspace/work/competitors/mem0 --python /workspace/work/venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/mem0-faiss.json
```

**graphiti-episodes-initial** — source `417c3a125ae3ac53c19b8e53fffaccf3e665a88e`; harness `2e95d2a83f38b5ce1c0adba414f4b0491356d7df`.

```bash
node scripts/compare.mjs --competitor graphiti-episodes --source /workspace/work/competitors/graphiti --python /workspace/work/probes-venv/bin/python --output benchmarks/measured/graphiti-episodes.json
```

**cognee-chunks-initial** — source `37f788bd287750e10d7610173e5332b3843f6ebd`; harness `2771927f8c82843c689864413b93110a7bed29b9`.

```bash
node scripts/compare.mjs --competitor cognee-chunks --source /workspace/work/competitors/cognee --python /workspace/work/cognee-venv/bin/python --model-dir /workspace/work/embeddings/minilm/package --output benchmarks/measured/cognee-chunks.json
```

The manifest is [run-manifest.json](benchmarks/measured/run-manifest.json).
Recompute the paired summary with the exact command recorded in its
`summary_command` field. No competitor code or prompt is copied. Competitor OSS
sources and the model retain Apache-2.0 licenses; ONNX Runtime is MIT. LoCoMo text
and derived report text retain CC BY-NC 4.0. sessionmem implementation remains MIT.
