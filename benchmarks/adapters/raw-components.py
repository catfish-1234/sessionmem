"""Raw episode/chunk component evaluation, without generated facts or answers."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import NAMESPACE_URL, uuid5
from local_minilm import LocalMiniLM, block_external_network

parser = argparse.ArgumentParser()
for name in ("input", "output", "source", "variant"):
    parser.add_argument("--" + name, required=True)
parser.add_argument("--model-dir")
parser.add_argument("--single", action="store_true")
args = parser.parse_args()
sys.path.insert(0, args.source)
corpus = json.loads(Path(args.input).read_text())
if not args.single:
    rows, captures = [], []
    with tempfile.TemporaryDirectory(prefix="raw-memory-components-") as temp:
        for i, conversation in enumerate(corpus):
            source = Path(temp) / f"{i}-input.json"
            target = Path(temp) / f"{i}-output.json"
            source.write_text(json.dumps([conversation]))
            subprocess.run([sys.executable, __file__, "--single", "--variant", args.variant,
                "--input", str(source), "--output", str(target), "--source", args.source,
                *(["--model-dir", args.model_dir] if args.model_dir else [])], check=True)
            result = json.loads(target.read_text())
            rows.extend(result["questions"])
            captures.extend(result["conversations"])
            print(f"Finished {conversation['id']}", file=sys.stderr, flush=True)
    Path(args.output).write_text(json.dumps({"questions": rows, "conversations": captures,
        "runtime": {"python": sys.version}, "external_network_attempts": 0}))
    sys.exit(0)

async def evaluate():
    conversation = corpus[0]
    clock = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = []
    with tempfile.TemporaryDirectory(prefix="raw-memory-component-") as temp:
        os.environ.update(GRAPHITI_TELEMETRY_ENABLED="false", ANONYMIZED_TELEMETRY="False",
                          COGNEE_LOGS_DIR=temp + "/logs", DATA_ROOT_DIRECTORY=temp + "/data",
                          SYSTEM_ROOT_DIRECTORY=temp + "/system", ENABLE_BACKEND_ACCESS_CONTROL="false",
                          CACHING="false", TELEMETRY_DISABLED="1", LITELLM_LOCAL_MODEL_COST_MAP="True")
        Path(temp + "/system/databases").mkdir(parents=True, exist_ok=True)
        model = None
        if args.variant == "cognee-chunks":
            model = LocalMiniLM(args.model_dir)
            # Populate the supported HF offline cache from the installed npm
            # tokenizer, rather than allowing query-time tokenizer downloads.
            hub = Path(temp) / "hf/hub"
            repo = hub / "models--sentence-transformers--all-MiniLM-L6-v2"
            revision = "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
            snapshot = repo / "snapshots" / revision
            snapshot.mkdir(parents=True)
            (repo / "refs").mkdir()
            (repo / "refs/main").write_text(revision)
            shutil.copyfile(Path(args.model_dir) / "tokenizer.json", snapshot / "tokenizer.json")
            (snapshot / "tokenizer_config.json").write_text(json.dumps({"model_max_length": 256}))
            os.environ.update(EMBEDDING_PROVIDER="openai_compatible", EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2",
                              EMBEDDING_DIMENSIONS="384", EMBEDDING_ENDPOINT=model.endpoint,
                              EMBEDDING_API_KEY="local-unused", EMBEDDING_ENCODING_FORMAT="float",
                              GRAPH_DATABASE_PROVIDER="turso", HF_HUB_CACHE=str(hub), HF_HUB_OFFLINE="1",
                              HF_HUB_DISABLE_TELEMETRY="1")
        attempts = block_external_network()
        if args.variant == "graphiti-episodes":
            from redislite.async_falkordb_client import AsyncFalkorDB
            from graphiti_core.driver.falkordb_driver import FalkorDriver
            from graphiti_core.nodes import EpisodicNode, EpisodeType
            from graphiti_core.search.search import episode_search
            from graphiti_core.search.search_config import EpisodeSearchConfig, EpisodeSearchMethod, EpisodeReranker
            from graphiti_core.search.search_filters import SearchFilters
            client = AsyncFalkorDB(dbfilename=temp + "/falkor.db")
            driver = FalkorDriver(falkor_db=client, database="locomo")
            await driver.build_indices_and_constraints()
            mapped = {}
            start = time.perf_counter()
            for group in conversation["sessions"]:
                for turn in group["turns"]:
                    uid = str(uuid5(NAMESPACE_URL, turn["id"]))
                    mapped[uid] = turn["id"]
                    await EpisodicNode(uuid=uid, name="", group_id=conversation["id"], source=EpisodeType.message,
                        source_description="", content=turn["content"], created_at=clock, valid_at=clock).save(driver)
            stored, _, _ = await driver.execute_query("MATCH (e:Episodic) RETURN count(e) AS n")
            if stored[0]["n"] != len(mapped):
                raise RuntimeError("Incomplete Graphiti episode capture")
            capture_ms = (time.perf_counter() - start) * 1000
            for question in conversation["questions"]:
                start = time.perf_counter()
                # Each process owns exactly one conversation's graph. Leave the
                # optional full-text group filter unset; isolation supplies scope.
                hits, _ = await episode_search(driver, None, question["question"], [], None,
                    EpisodeSearchConfig(search_methods=[EpisodeSearchMethod.bm25], reranker=EpisodeReranker.rrf),
                    SearchFilters(), limit=5)
                rows.append({"id": question["id"], "retrieved": [mapped[h.uuid] for h in hits],
                             "latency_ms": (time.perf_counter() - start) * 1000})
            await driver.close()
            # The embedded server's async client needs explicit shutdown; its
            # inherited synchronous destructor cannot await this coroutine.
            try:
                await client.client.shutdown(save=False)
            except ConnectionError:
                pass
        elif args.variant == "cognee-chunks":
            from cognee.modules.chunking.models.DocumentChunk import DocumentChunk
            from cognee.modules.data.processing.document_types.Document import Document
            from cognee.tasks.storage.add_data_points import add_data_points
            from cognee.modules.retrieval.chunks_retriever import ChunksRetriever
            mapped, chunks = {}, []
            for group in conversation["sessions"]:
                document = Document(id=uuid5(NAMESPACE_URL, group["id"]), name="", raw_data_location="",
                    external_metadata=None, mime_type="text/plain", metadata={"index_fields": []})
                for index, turn in enumerate(group["turns"]):
                    uid = uuid5(NAMESPACE_URL, turn["id"])
                    mapped[str(uid)] = turn["id"]
                    chunks.append(DocumentChunk(id=uid, text=turn["content"], chunk_size=len(turn["content"]),
                        chunk_index=index, cut_type="raw-turn", is_part_of=document, contains=[],
                        created_at=int(clock.timestamp() * 1000), updated_at=int(clock.timestamp() * 1000)))
            start = time.perf_counter()
            await add_data_points(chunks)
            capture_ms = (time.perf_counter() - start) * 1000
            retriever = ChunksRetriever(top_k=5)
            for question in conversation["questions"]:
                start = time.perf_counter()
                hits = await retriever.get_retrieved_objects(question["question"])
                rows.append({"id": question["id"], "retrieved": [mapped[str(h.id)] for h in hits],
                             "latency_ms": (time.perf_counter() - start) * 1000})
        else:
            raise ValueError(args.variant)
        if attempts:
            raise RuntimeError(f"External network attempted: {attempts}")
        Path(args.output).write_text(json.dumps({"questions": rows, "conversations": [{
            "id": conversation["id"], "memories": len(mapped), "capture_ms": capture_ms}]}))
        if model:
            model.close()
asyncio.run(evaluate())
