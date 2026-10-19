"""Launch the pinned installed chroma-mcp with provisioned local MiniLM files.

Only the cache location and model provisioning differ from normal Chroma startup.
No retrieval implementation is replaced. Never reads or writes the user's cache.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--model-dir", required=True)
parser.add_argument("--cache-dir", required=True)
args, rest = parser.parse_known_args()
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["ORT_DISABLE_TELEMETRY"] = "1"
from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import ONNXMiniLM_L6_V2
import onnxruntime as ort

# Match the one-thread CPU inference setting used by the other local adapters.
# Chroma does not expose this SessionOptions field through chroma-mcp settings.
original_session = ort.InferenceSession
def cpu_session(*args, **kwargs):
    options = kwargs.get("sess_options") or ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    kwargs["sess_options"] = options
    return original_session(*args, **kwargs)
ort.InferenceSession = cpu_session

cache = Path(args.cache_dir)
target = cache / ONNXMiniLM_L6_V2.EXTRACTED_FOLDER_NAME
target.mkdir(parents=True, exist_ok=True)
shutil.copyfile(Path(args.model_dir) / "onnx/model.onnx", target / "model.onnx")
shutil.copyfile(Path(args.model_dir) / "tokenizer.json", target / "tokenizer.json")
# Chroma checks these ancillary files exist; its ONNX embedder only opens the
# tokenizer.json and model.onnx above. Derive the vocabulary from that tokenizer.
tokenizer = json.loads((target / "tokenizer.json").read_text())
(target / "vocab.txt").write_text("\n".join(token for token, _ in sorted(tokenizer["model"]["vocab"].items(), key=lambda kv: kv[1])))
for filename in ("config.json", "tokenizer_config.json", "special_tokens_map.json"):
    (target / filename).write_text("{}")
ONNXMiniLM_L6_V2.DOWNLOAD_PATH = cache

original_connect = socket.socket.connect
def guarded_connect(sock, address):
    if not isinstance(address, tuple) or address[0] not in ("127.0.0.1", "::1"):
        with open(cache / "external-network-attempts.txt", "a") as log:
            log.write(str(address) + "\n")
        raise RuntimeError("External network forbidden in local evaluation")
    return original_connect(sock, address)
socket.socket.connect = guarded_connect
sys.argv = ["chroma-mcp", *rest]
from chroma_mcp import main
main()
