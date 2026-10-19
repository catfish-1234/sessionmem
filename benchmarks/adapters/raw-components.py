"""Raw episode/chunk component evaluation, without generated facts or answers."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
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
        model = None
        if args.variant == "cognee-chunks":
            model = LocalMiniLM(args.model_dir)
            os.environ.update(EMBEDDING_PROVIDER="openai", EMBEDDING_MODEL="local-minilm",
                              EMBEDDING_DIMENSIONS="384", EMBEDDING_ENDPOINT=model.endpoint,
                              EMBEDDING_API_KEY="local-unused", EMBEDDING_ENCODING_FORMAT="float")
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
            capture_ms = (time.perf_counter() - start) * 1000
            for question in conversation["questions"]:
                start = time.perf_counter()
                hits, _ = await episode_search(driver, None, question["question"], [], [conversation["id"]],
                    EpisodeSearchConfig(search_methods=[EpisodeSearchMethod.bm25], reranker=EpisodeReranker.rrf),
                    SearchFilters(), limit=5)
                rows.append({"id": question["id"], "retrieved": [mapped[h.uuid] for h in hits],
                             "latency_ms": (time.perf_counter() - start) * 1000})
            await driver.close()
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
                        chunk_index=index, cut_type="raw-turn", is_part_of=document,
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
