"""Evaluation-only local OpenAI-compatible embedding transport; no remote calls."""
import json
from pathlib import Path
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def block_external_network():
    attempts = []
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_lookup = socket.getaddrinfo
    def check(sock, address):
        if sock.family == socket.AF_UNIX:
            return
        if not isinstance(address, tuple) or address[0] not in ("127.0.0.1", "::1"):
            attempts.append(str(address))
            raise RuntimeError("External network forbidden in local evaluation")
    def connect(sock, address):
        check(sock, address)
        return original_connect(sock, address)
    def connect_ex(sock, address):
        check(sock, address)
        return original_connect_ex(sock, address)
    def lookup(host, *args, **kwargs):
        if host not in ("localhost", "127.0.0.1", "::1", None):
            attempts.append(str(host))
            raise RuntimeError("External DNS forbidden in local evaluation")
        return original_lookup(host, *args, **kwargs)
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = lookup
    return attempts

class LocalMiniLM:
    def __init__(self, model_dir):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        model_dir = Path(model_dir)
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        session = ort.InferenceSession(str(model_dir / "onnx/model.onnx"), options, providers=["CPUExecutionProvider"])
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
                token_count = 0
                for text in texts:
                    encoded = tokenizer.encode(text)
                    token_count += len(encoded.ids)
                    ids = np.array([encoded.ids], dtype=np.int64)
                    hidden = session.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids),
                                               "token_type_ids": np.zeros_like(ids)})[0]
                    vector = hidden.mean(axis=1)[0]
                    vector /= max(float(np.linalg.norm(vector)), 1e-12)
                    vectors.append(vector.tolist())
                raw = json.dumps({"object": "list", "model": "local-minilm", "usage": {"prompt_tokens": token_count, "total_tokens": token_count},
                    "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
    def close(self):
        self.server.shutdown()
