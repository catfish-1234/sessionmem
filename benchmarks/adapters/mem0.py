"""Run unmodified Mem0 OSS public APIs with a loopback-only ONNX embedder.

Raw-turn capture uses the supported infer=False path. This does not benchmark
LLM extraction, consolidation, or a hosted Mem0 service. No upstream code copied.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--model-dir", required=True)
args = parser.parse_args()
sys.path.insert(0, args.source)
os.environ["MEM0_TELEMETRY"] = "false"
os.environ["HF_HUB_OFFLINE"] = "1"

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

model_dir = Path(args.model_dir)
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
options.enable_cpu_mem_arena = False
session = ort.InferenceSession(str(model_dir / "onnx/model.onnx"), options,
                              providers=["CPUExecutionProvider"])
tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
tokenizer.enable_truncation(max_length=256)
tokenizer.no_padding()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        texts = body["input"]
        if isinstance(texts, str):
            texts = [texts]
        vectors = []
        for text in texts:
            enc = tokenizer.encode(text)
            ids = np.array([enc.ids], dtype=np.int64)
            mask = np.ones_like(ids)
            hidden = session.run(None, {"input_ids": ids, "attention_mask": mask,
                                       "token_type_ids": np.zeros_like(ids)})[0]
            vector = hidden.mean(axis=1)[0]
            vector /= max(float(np.linalg.norm(vector)), 1e-12)
            vectors.append(vector.tolist())
        raw = json.dumps({"object": "list", "model": "local-minilm",
                          "data": [{"object": "embedding", "index": i, "embedding": v}
                                   for i, v in enumerate(vectors)]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
# Enforce loopback-only networking in this process, including caught attempts.
attempts = []
original_connect = socket.socket.connect
def guarded_connect(sock, address):
    if not isinstance(address, tuple) or address[0] not in ("127.0.0.1", "::1"):
        attempts.append(str(address))
        raise RuntimeError("External network forbidden in local evaluation")
    return original_connect(sock, address)
socket.socket.connect = guarded_connect

from mem0 import Memory

corpus = json.loads(Path(args.input).read_text())
rows, captures = [], []
try:
    with tempfile.TemporaryDirectory(prefix="locomo-mem0-") as temp:
        os.environ["MEM0_DIR"] = temp
        for ci, conversation in enumerate(corpus):
            memory = Memory.from_config({
                "embedder": {"provider": "openai", "config": {
                    "model": "local-minilm", "embedding_dims": 384,
                    "api_key": "local-unused", "openai_base_url": f"http://127.0.0.1:{server.server_port}/v1"}},
                "llm": {"provider": "ollama", "config": {"model": "unused-infer-false"}},
                "vector_store": {"provider": "faiss", "config": {
                    "collection_name": "locomo", "embedding_model_dims": 384,
                    "distance_strategy": "cosine", "path": f"{temp}/{ci}/vectors"}},
                "history_db_path": f"{temp}/{ci}.db",
            })
            start = time.perf_counter()
            count = 0
            for group in conversation["sessions"]:
                for turn in group["turns"]:
                    added = memory.add(turn["content"], user_id=conversation["id"], infer=False,
                                       metadata={"turn_id": turn["id"], "session_id": group["id"],
                                                 "created_at": "2026-01-01T00:00:00.000Z"})
                    if len(added["results"]) != 1:
                        raise RuntimeError(f"Capture failed: {turn['id']}")
                    count += 1
            captures.append({"id": conversation["id"], "memories": count,
                             "capture_ms": (time.perf_counter() - start) * 1000})
            for question in conversation["questions"]:
                start = time.perf_counter()
                result = memory.search(question["question"], filters={"user_id": conversation["id"]}, top_k=5)
                elapsed = (time.perf_counter() - start) * 1000
                rows.append({"id": question["id"], "retrieved": [r["metadata"]["turn_id"] for r in result["results"]],
                             "latency_ms": elapsed})
            memory.close()
            print(f"Finished {ci + 1}/{len(corpus)}", file=sys.stderr, flush=True)
    if attempts:
        raise RuntimeError(f"External network attempted: {attempts}")
    Path(args.output).write_text(json.dumps({"questions": rows, "conversations": captures,
        "runtime": {"python": sys.version, "onnxruntime": ort.__version__, "numpy": np.__version__},
        "model_sha256": hashlib.sha256((model_dir / "onnx/model.onnx").read_bytes()).hexdigest(),
        "external_network_attempts": len(attempts)}))
finally:
    server.shutdown()
