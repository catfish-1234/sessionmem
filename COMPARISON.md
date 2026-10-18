# sessionmem, claude-mem, Mem0, and Zep

This comparison covers capture, retrieval, data locality, and evaluation. Competitor
descriptions below reflect their linked public documentation, checked on
2026-10-18; they are documented claims, not results from running those products
through sessionmem's evaluator. Hosted services and their open-source components
are distinguished because their deployment requirements and features differ.

## Capture and retrieval

| Project | Capture model | Retrieval approach |
| --- | --- | --- |
| **sessionmem** | MCP memory tools and CLI. Claude Code's installed PostToolUse, SessionEnd, and SessionStart hooks capture supported tool events, summarize locally, and inject prior context. Other MCP hosts rely on agent/tool calls or host lifecycle integration. `scan` and `watch` import Claude Code transcripts offline. | SQLite FTS5 BM25 with English stop-word filtering and Porter stemming, plus entity overlap, recency, and importance. Deterministic supersession rules exclude fully replaced memories by default; history is available explicitly. See [architecture](docs/architecture.md) and [capture/setup](README.md#quickstart). |
| **claude-mem** | Lifecycle hooks feed a local worker, which processes observations with an AI provider and saves summaries for later sessions. Its docs describe Claude Agent SDK processing and alternative providers. | SQLite FTS5 plus optional Chroma semantic search; progressive disclosure through `search`, `timeline`, and `get_observations`. See its [architecture](https://docs.claude-mem.ai/architecture/overview) and [search documentation](https://docs.claude-mem.ai/architecture/search-architecture). |
| **Mem0** | Application SDK/API calls submit messages for fact extraction. Available as an OSS library/self-hosted server and a managed Platform; MCP can let an agent choose when to add/search memories. | The current docs describe semantic/vector, BM25 keyword, and entity signals. Platform Graph Memory links shared entities into retrieval; OSS supports entity-aware ranking but has no queryable graph in the current pipeline. See [quickstart](https://docs.mem0.ai/platform/quickstart), [Graph Memory](https://docs.mem0.ai/platform/features/graph-memory), and [Platform vs OSS](https://docs.mem0.ai/platform/platform-vs-oss). |
| **Zep** | Applications send conversation messages and business data through SDK/API calls into temporal Context Graphs. The managed service maintains users, threads, and graphs. | Semantic similarity and BM25 full-text search, optional breadth-first graph search, and reranking; context assembly can combine facts, entities, episodes, observations, and thread summaries. See [capture quickstart](https://help.getzep.com/quick-start-guide) and [graph search](https://help.getzep.com/v4/searching-the-graph). |

sessionmem's entity contribution reranks existing candidates; it does not expand
the candidate pool or traverse relations. Its hash-vector fallback is not a
learned semantic embedding model. Supersession uses conservative language rules,
not general contradiction reasoning: unfamiliar wording can be missed or
misclassified. Partially superseded memories remain searchable while any claim
is current, so their bodies can still contain stale claims. See
[retrieval](docs/architecture.md#retrieval-flow) and
[supersession limitations](docs/architecture.md#contradiction-and-supersession).

## Offline operation and data locality

**sessionmem's local memory pipeline requires no API keys and makes no network
calls.** Capture, local summarization, entity/relation extraction, supersession,
and retrieval work offline without downloading models. The default store is
`~/.sessionmem/memories.db`; no hosted memory service is required. This guarantee
covers sessionmem's local pipeline, independently of the coding agent's own model
connection. Package installation may need a network connection or an offline
package cache. See [setup](README.md#quickstart) and [architecture](docs/architecture.md).

There are explicit opt-ins outside that guarantee:
[cloud summarization](docs/cloud-summarization.md) requires both
`allowCloudSummarization=true` and `ANTHROPIC_API_KEY`, and sends a redacted
transcript to Anthropic. [Team mode](docs/team-mode.md) shares memories through a
chosen folder, whose network/sync behavior is controlled by the user. The optional
[read-only viewer](README.md#inspect-memories-in-your-browser) serves bundled
assets over loopback HTTP; it needs no external services or CDNs.

| Project | Documented locality and offline considerations |
| --- | --- |
| **claude-mem** | SQLite storage and the worker/viewer are local. Local storage alone does not make AI observation processing offline: the default Claude provider uses subscription/API authentication. The docs also support Ollama, LM Studio, and vLLM endpoints with no API key, so it would be inaccurate to call claude-mem cloud-only. Local inference still requires a configured model server. See [architecture](https://docs.claude-mem.ai/architecture/overview), [configuration](https://docs.claude-mem.ai/configuration), and [local provider presets](https://docs.claude-mem.ai/usage/openai-compatible-provider). |
| **Mem0** | Platform uses an authenticated hosted API. OSS gives the operator infrastructure/data control, but the default library setup uses OpenAI for extraction and embeddings. Local operation requires configuring local components, including both the LLM and embedder; selecting only a local LLM leaves the default remote embedder in place. See [OSS defaults](https://docs.mem0.ai/open-source/overview), [Ollama LLM](https://docs.mem0.ai/components/llms/models/ollama), and [Ollama embeddings](https://docs.mem0.ai/components/embedders/models/ollama). |
| **Zep** | The managed SDK workflow requires a Zep account/API key and service connection. Zep documents Cloud, customer-key encryption, and BYOC deployments. Its separate open-source Graphiti framework is self-hosted with pluggable graph backends; this does not establish a no-network/no-key guarantee for the managed Zep product. See [quickstart](https://help.getzep.com/quick-start-guide) and [Zep vs Graphiti](https://help.getzep.com/zep-vs-graphiti). |

## Evaluation and measured results

sessionmem commits the unmodified [LoCoMo corpus](benchmarks/data/locomo10.json),
[provenance/checksums](benchmarks/data/provenance.json), and
[offline runner](scripts/benchmark.mjs). The corpus contains 10 conversations,
272 sessions, and 5,882 turns. The evaluator scores 1,527 of 1,986 questions;
fixed annotation rules exclude 446 adversarial, four missing-evidence, and nine
invalid-evidence questions. The dataset retains its separate CC BY-NC 4.0 license.

The runner stores dialogue turns through the public `storeMemory` API in isolated
in-memory databases, then passes original questions unchanged to
`retrieveMemories`. Questions, answers, and supplied summaries do not enter
searchable memory. It fixes clocks, uses equal importance, verifies the corpus
checksum, and blocks HTTP/fetch, TCP/TLS, UDP, and DNS. Any network attempt fails
the run, even if application fallback code catches the error. No API keys or
model judge are needed. See the full [methodology](benchmarks/README.md).

Current measured LoCoMo results, also recorded in
[benchmark documentation](docs/benchmark.md) and
[aggregate results](benchmarks/entity-overlap-results.json):

| Macro retrieval metric | @5 |
| --- | ---: |
| Hit rate | **63.92%** |
| Recall | **57.45%** |
| Precision | **14.05%** |

A hit means at least one annotated evidence turn was retrieved. Recall measures
the fraction of annotated evidence found; precision measures the fraction of
returned turns annotated as evidence, using the actual result count. These are
question-level macro averages, not generated-answer accuracy. This evaluation
does not measure automatic capture selection, session summarization, extraction
accuracy, or token-budgeted startup injection. The corpus was also used during
ranker development, so these are not held-out generalization results or evidence
of performance on coding sessions.

After provisioning lockfile dependencies with `npm ci` or an offline cache:

```bash
npm run build
npm run benchmark -- --output benchmarks/results/locomo.json
```

The build and runner work offline after dependencies are installed. The JSON
includes configuration, exclusions, per-question evidence/results, and timings;
quality scores are reproducible for the same checkout/configuration, while
latency varies with hardware and load.

| Competitor | Public evaluation claims and comparability |
| --- | --- |
| **claude-mem** | No comparable offline LoCoMo top-5 annotated-evidence benchmark was found in the reviewed [architecture](https://docs.claude-mem.ai/architecture/overview) and [search docs](https://docs.claude-mem.ai/architecture/search-architecture). Their workflow/token-efficiency claims do not supply comparable hit rate, recall, or precision. No score is inferred here. |
| **Mem0** | Publishes LoCoMo and other benchmark results, and links an open evaluation framework on its [research page](https://mem0.ai/research). Its [benchmark-reading guide](https://mem0.ai/library/agent-memory/how-to-read-memory-benchmarks) describes managed-platform results with an answer model, LLM judge, and a different retrieval budget. No comparable offline top-5 annotated-turn result is published in these sources. Those answer scores cannot be ranked against sessionmem's evidence-retrieval metrics. |
| **Zep** | Publishes LoCoMo answer accuracy with reader/judge models and multi-scope retrieval on its [research page](https://www.getzep.com/research/). Its public [evaluation harness guide](https://help.getzep.com/evaluate-zep-for-your-use-case) requires service/model API keys. No comparable offline top-5 annotated-turn result is published in these sources. Running an evaluation script locally does not make the evaluated service offline. |

## Where competitors offer more

- **claude-mem:** its documented real-time React viewer, live memory stream, and
  settings interface offer a richer interactive dashboard than sessionmem's
  read-only browser. Its staged search/timeline/detail workflow is useful for
  investigating session history. See [viewer architecture](https://docs.claude-mem.ai/architecture/overview)
  and [search workflow](https://docs.claude-mem.ai/architecture/search-architecture).
- **Mem0:** managed infrastructure, scaling, audit logs, and workspace governance
  reduce operations work for application teams. Its documented integrations with
  LangChain, LangGraph, CrewAI, and other frameworks are broader than sessionmem's
  coding-host adapters. See [Platform features](https://docs.mem0.ai/platform/overview)
  and [integrations](https://docs.mem0.ai/integrations).
- **Zep:** managed graph operations, graph visualization, debug/API logs, access
  policies, and deployment options serve requirements beyond a local project
  memory store. Its graph traversal and configurable rerankers provide retrieval
  capabilities sessionmem's entity overlap does not implement. See
  [managed features](https://help.getzep.com/zep-vs-graphiti) and
  [graph search](https://help.getzep.com/v4/searching-the-graph).

sessionmem fits users who need a small, inspectable local memory pipeline with
no model/service dependency. That tradeoff comes with rule-based extraction and
supersession, lexical retrieval limitations, and fewer hosted management features.
