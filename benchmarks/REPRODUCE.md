# Reproducing the local comparison

All quality results use the committed corpus and scorer in [README.md](README.md).
The exact evaluation commands and source commits are listed in
[COMPARISON.md](../COMPARISON.md) and in the JSON reports. Result archives are
ordinary gzip-compressed JSON, with complete per-question evidence, results and
timings. `gzip -dc FILE.json.gz` reads one without modifying it.

The measured environment was Linux x64, Node 24.19.0, Python 3.12.14, Bun 1.4.3,
on Intel Xeon Platinum 8573C, three visible CPUs with a two-CPU quota
(`cpu.max = 200000 100000`) and 8 GiB memory limit. Local neural inference used one CPU
thread. Timing is a single pass in original question order, without warmup
queries. Model startup and index construction happen before retrieval timing;
sessionmem records model load and capture times separately. Runtime/library
versions are pinned in the lockfile and the `measured/*-requirements.txt` files.
The first main run used the workspace's preprovisioned dependency tree, before
the optional packages normalized it to the lockfile. The later quiet main run
uses the same installed tree as the final hybrid and reproduces every retrieved
ID and quality score. Its latency is reported separately from the first run.

## Provisioning

The commands below show the original `/workspace/work` paths. They may be
replaced consistently with a writable directory on another machine.

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run build
mkdir -p /workspace/work/competitors /workspace/work/embeddings/minilm
git clone https://github.com/thedotmack/claude-mem.git /workspace/work/competitors/claude-mem
git clone https://github.com/mem0ai/mem0.git /workspace/work/competitors/mem0
git clone https://github.com/getzep/graphiti.git /workspace/work/competitors/graphiti
git clone https://github.com/topoteretes/cognee.git /workspace/work/competitors/cognee
git clone https://github.com/getzep/zep-python.git /workspace/work/competitors/zep-python
git -C /workspace/work/competitors/claude-mem checkout b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0
git -C /workspace/work/competitors/mem0 checkout 0724291bd864cf807e88ee8981c8226644e8fb42
git -C /workspace/work/competitors/graphiti checkout 417c3a125ae3ac53c19b8e53fffaccf3e665a88e
git -C /workspace/work/competitors/cognee checkout 37f788bd287750e10d7610173e5332b3843f6ebd
git -C /workspace/work/competitors/zep-python checkout 980092a27003f3ae45b76581ee2568f0c5e2b727
```

The model package installed by `npm ci` has the same checked files as the npm
tarball used by the adapters. To reconstruct the adapter's original model path:

```bash
cp -R node_modules/@xcidos/genesis-memory-model /workspace/work/embeddings/minilm/package
npm install --prefix /workspace/work/tools --ignore-scripts bun@1.4.3
ln -s "$PWD/node_modules" /workspace/work/competitors/claude-mem/node_modules
uv venv /workspace/work/venv
uv pip install --python /workspace/work/venv/bin/python -r benchmarks/measured/mem0-requirements.txt
uv venv /workspace/work/chroma-venv
uv pip install --python /workspace/work/chroma-venv/bin/python -r benchmarks/measured/chroma-requirements.txt
uv venv /workspace/work/probes-venv
uv pip install --python /workspace/work/probes-venv/bin/python -r benchmarks/measured/graphiti-requirements.txt
uv venv /workspace/work/cognee-venv
uv pip install --python /workspace/work/cognee-venv/bin/python -r benchmarks/measured/cognee-requirements.txt
```

The requirements contain editable paths to these pinned competitor checkouts.
Package installation may use the network. Evaluation uses no paid keys or model
services. `local-unused` is a placeholder accepted only by the loopback embedding
server, which runs the actual local ONNX model. Python adapters reject external
connections; the Node adapter and sessionmem runner also block network APIs.
Final repeats additionally set `ORT_DISABLE_TELEMETRY=1` before native inference
initialization. Application guards do not intercept native sockets. The separate
[native smoke trace](measured/native-offline.json) records model loading and one
embedding with zero network system calls; it is not a trace of every evaluation
query. Initial reports predate the explicit native opt-out and remain archived.

## What each adapter measures

| Variant | Capture and retrieval boundary |
| --- | --- |
| sessionmem | Public `storeMemory` / `retrieveMemories`, including normal capture redaction, claim/entity extraction, and startup-injection formatting |
| Mem0 OSS / FAISS | Public `Memory.add(infer=False)` / `Memory.search(top_k=5)`. Actual local MiniLM through a loopback OpenAI-compatible embedding endpoint, cosine FAISS, installed spaCy, default semantic threshold, no LLM reranker. FAISS has no BM25 channel; raw capture does not run fact extraction/entity linking |
| claude-mem SQLite | Upstream `SessionStore.storeObservation` and `SessionSearch.searchObservations`, relevance ordering, one complete raw turn in the required title field |
| claude-mem Chroma | Same observations, upstream document formatter/bulk add, `ChromaSync` and `SearchOrchestrator`; actual chroma-mcp 0.2.6 / Chroma 1.5.9. No implicit recency window; top-five observations only. The configured local MCP transport replaces uvx installation during the run. Model files populate an isolated cache; CPU SessionOptions use one thread. All queries must report using Chroma |
| Graphiti episodes | Upstream `EpisodicNode.save` / `episode_search`, BM25 and RRF, embedded FalkorDB Lite. Separate process/database per conversation. `group_ids=None`: database isolation supplies scope. The hyphenated upstream conversation IDs gave empty results with the optional full-text group filter in a setup probe; no ranker/filter source was patched |
| cognee chunks | Upstream `DocumentChunk` / `add_data_points` / `ChunksRetriever.get_retrieved_objects`, local Turso graph and LanceDB vector store, actual MiniLM through the loopback OpenAI-compatible provider. One turn per chunk, no generated summary, no LLM completion. A local HF-format cache supplies the installed tokenizer and a declared 256-token limit. Fresh process and stores per conversation |

These are raw-turn retrieval configurations, not complete product evaluations.
They do not score observation generation, fact extraction, graph construction,
contradiction detection, or answer generation. In particular, Graphiti's episode
search does not exercise its semantic entity/edge search or BFS, and cognee's
chunk search does not exercise its hybrid graph retriever. Their default generated
pipelines remain unmeasured under the recorded model/credential restrictions.

No question, answer, evidence ID, or supplied summary enters searchable memory.
The orchestrator sends adapters only raw turns and original query text. Turn IDs
are mapped to provider IDs outside the searchable text. It validates returned
IDs, result limits, question counts and source cleanliness, then uses the same
scorer as sessionmem. No annotation repair or answer-text matching is used.

## Artifacts and licenses

`scripts/summarize-comparison.mjs` checks corpus identity and question coverage,
and emits readable aggregates and every question whose recall regressed against
the first report. The gzip archives preserve the full original JSON. Some early
timing runs overlapped checks; those remain archived and are identified separately
from the final sequential pair. Runtime variation is not statistical significance.

The reports contain LoCoMo question/answer text. That text retains the dataset's
[CC BY-NC 4.0 license](data/LICENSE.txt), provenance and attribution in
[README.md](README.md); the repository's MIT license does not replace it.
The MiniLM model/tokenizer retain their separate Apache-2.0 attribution described
in [local semantic setup](../docs/local-semantic.md). No competitor implementation
or prompt is redistributed in these adapters.
