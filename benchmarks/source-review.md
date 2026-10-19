# Source review

Reviewed on 2026-10-18. These are observations about the pinned source below,
not measured quality claims. No competitor implementation or prompt was copied.
Names of public APIs and standard retrieval algorithms identify approaches only.
All four reviewed source trees declare Apache-2.0 at these commits. sessionmem
remains MIT; model and dataset licenses are separate.

The sessionmem feature gaps below describe unchanged main
`c4ebced00784c77d2c926c625a3b196afe560b28`, before this PR's optional semantic path.

## claude-mem

Source: [thedotmack/claude-mem at b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0](https://github.com/thedotmack/claude-mem/tree/b85cd123daf8e5bd59edb2d1c7b98e0bba28b3a0).

- Capture: lifecycle hooks enqueue tool/session events; worker providers generate
  structured observations and session summaries. See `plugin/hooks/hooks.json`,
  `src/services/worker/OpenAICompatibleProvider.ts` and
  `src/services/worker/agents/ResponseProcessor.ts`. Capture automation belongs
  to the host integration; AI processing is a separate requirement. Local
  OpenAI-compatible providers exist, so an Anthropic key is not universally required.
- Retrieval: `src/services/worker/search/SearchOrchestrator.ts` chooses Chroma
  semantic search when configured and SQLite search when disabled. The Chroma
  strategy queries vectors and hydrates scoped IDs from SQLite, with date and
  category filtering. File search intersects SQLite metadata with vector ranking.
  `src/services/sqlite/SessionSearch.ts` tries quoted AND FTS terms, substring
  matching, then an OR widening for sufficiently long queries; relevance ordering
  uses FTS rank. This is not the same ranker as sessionmem's Porter/stop-word FTS.
- History: staged search, timeline, and full observation fetch support exploration.
  Observation title/content deduplication and reinforcement exist. I did not find
  a general fact-level contradiction resolver in the reviewed observation storage
  and search path. Generation-job supersession and cache invalidation concern
  processing state, not contradictory user facts.
- sessionmem lacks learned semantic candidates, comparable progressive disclosure,
  and the richer live worker/viewer workflow. It already has host hooks and
  transcript capture, so automatic capture is not wholly absent.

## Mem0 OSS

Source: [mem0ai/mem0 at 0724291bd864cf807e88ee8981c8226644e8fb42](https://github.com/mem0ai/mem0/tree/0724291bd864cf807e88ee8981c8226644e8fb42).

- Capture: application calls `Memory.add`; `infer=True` gathers recent messages
  and semantically related existing memories, asks an LLM for extracted facts,
  embeds and deduplicates them, persists batches, and links entities.
  `infer=False` stores submitted messages directly, without calling the LLM.
  See `mem0/memory/main.py`, `_add_to_vector_store` and `_create_memory`.
- Retrieval: `_search_vector_store` embeds the original query, overfetches dense
  candidates, asks the backend for keyword matches when supported, adds entity
  boosts, and applies a semantic threshold. `mem0/utils/scoring.py` combines
  semantic, sigmoid-normalized BM25, and entity scores additively. An optional
  configured reranker can run afterwards. FAISS does not supply the keyword
  channel; Qdrant has a sparse BM25 implementation. These configurations must
  not be described as equivalent.
- Contradictions: the default capture path at this commit uses
  `ADDITIVE_EXTRACTION_PROMPT` and adds facts; related existing memory IDs can
  guide extraction. The older four-operation update/delete prompt is still in
  `mem0/configs/prompts.py` but is not the default add path. Explicit `update`
  and `delete` APIs update vectors/entity links and record history. Do not infer
  automatic contradiction resolution from an unused prompt.
- sessionmem lacks a learned dense candidate pool, interchangeable vector/LLM
  backends, and optional learned rerankers. Its entity signal only reranks lexical
  candidates on main. Neither this review nor the raw-turn benchmark establishes
  a contradiction-accuracy advantage for Mem0.

## Zep and Graphiti

Sources: [getzep/graphiti at 417c3a125ae3ac53c19b8e53fffaccf3e665a88e](https://github.com/getzep/graphiti/tree/417c3a125ae3ac53c19b8e53fffaccf3e665a88e)
and [getzep/zep-python at 980092a27003f3ae45b76581ee2568f0c5e2b727](https://github.com/getzep/zep-python/tree/980092a27003f3ae45b76581ee2568f0c5e2b727).

- Zep's SDK is a client, not the service implementation. Its `base_client.py`
  requires an API key and `environment.py` defaults to the hosted v4 endpoint.
  Server-side capture, ranking, and contradiction behavior cannot be audited from
  that SDK. Graphiti is a separate OSS framework; its behavior is not proof of
  the managed Zep service's implementation.
- Graphiti's `graphiti_core/graphiti.py` `add_episode` extracts entities and
  relationships, resolves duplicate nodes/edges, embeds them, and persists episode
  provenance and graph links. An application still has to submit the episode.
- `graphiti_core/search/search.py` combines configured full-text, cosine, and
  breadth-first graph searches. Supported rerankers include reciprocal rank fusion
  (RRF), maximal marginal relevance, cross-encoders, graph distance, and episode
  mentions. Nodes, edges, episodes, and communities have distinct search paths.
- `utils/maintenance/edge_operations.py` asks the LLM to identify duplicate and
  contradictory facts, validates returned indices, and applies temporal
  invalidation using valid/invalid times while retaining historical edges and
  episode provenance. Late-arriving older information can itself be expired.
  This combines semantic judgment with time rules; it is not infallible logic.
- sessionmem lacks traversal-based candidate expansion, temporal graph search,
  configurable rerankers, and general model-based contradiction detection. Its
  conservative rules only cover supported claim forms, and partially superseded
  bodies can retain old claims.

## cognee

Source: [topoteretes/cognee at 37f788bd287750e10d7610173e5332b3843f6ebd](https://github.com/topoteretes/cognee/tree/37f788bd287750e10d7610173e5332b3843f6ebd).

- `cognee/api/v1/add/add.py` ingests documents; `cognify/cognify.py` classifies,
  chunks, extracts graphs/summaries, and embeds data points. Applications invoke
  this pipeline; it is not automatically observing every host conversation.
  `modules/cognify/config.py` can choose a local GLiNER demo extractor when no
  LLM credentials are configured. Default local extraction weights are
  `fastino/gliner2.5-base-v1`, loaded from the Hugging Face Hub.
- `modules/retrieval/hybrid_retriever.py` retrieves chunk/summary, entity, and
  fact channels. `hybrid/chunks.py` hydrates source chunks and
  `hybrid/ranking.py` fuses chunk and summary ranks with RRF, optionally weighting
  importance and other configured signals. Retrieval and LLM answer completion
  are distinct stages. `temporal_hybrid_retriever.py` adds date-based reranking.
- `tasks/memify/review_conflicts` runs a separate model-assisted fact review,
  validates references, and persists conflict/current/superseded marks with cited
  evidence. `modules/graph/utils/fact_conflicts.py` defines precedence and labels.
  This is not a guarantee that every `add` automatically removes stale claims.
- sessionmem lacks document graph construction, multi-channel graph retrieval,
  temporal reranking, and model-assisted conflict review. Their cost and accuracy
  are unmeasured here.

## What this evaluation can establish

The common task is top-five annotated dialogue-turn retrieval. Raw-turn adapters
deliberately avoid generated facts/summaries, answer models, and judges. This
isolates retrieval, and does not compare end-to-end capture selection or graph
construction. A graph fact or generated observation is not interchangeable with
one annotated turn. No published vendor accuracy or token-savings numbers are
used as measured head-to-head results.
