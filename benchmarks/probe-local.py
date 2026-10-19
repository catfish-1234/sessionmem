"""Record actual initialization and free model-download blockers; no paid calls."""
import argparse
import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--sources", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
sources = Path(args.sources)
for name in ("OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "ZEP_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY"):
    os.environ.pop(name, None)

results = {}
with tempfile.TemporaryDirectory(prefix="memory-local-probes-") as temp:
    os.environ.update(COGNEE_LOGS_DIR=temp + "/logs", DATA_ROOT_DIRECTORY=temp + "/data",
                      SYSTEM_ROOT_DIRECTORY=temp + "/system", GLINER_AUTO_INSTALL="false",
                      HF_HUB_OFFLINE="1", LITELLM_LOCAL_MODEL_COST_MAP="True", TELEMETRY_DISABLED="1")
    from graphiti_core import Graphiti
    from zep_cloud import Zep
    import cognee

    for name, initialize in (("graphiti-default", lambda: Graphiti("bolt://127.0.0.1:7687", "neo4j", "local")),
                             ("zep-sdk", Zep),
                             ("cognee-gliner-runtime", lambda: asyncio.run(cognee.cognify(extractor="gliner_demo")))):
        try:
            initialize()
            results[name] = {"initialized": True}
        except Exception as error:
            results[name] = {"initialized": False, "error_type": type(error).__name__, "error": str(error)}

for name, url in (("gliner-weights", "https://huggingface.co/fastino/gliner2.5-base-v1/resolve/main/config.json"),
                  ("ollama-registry", "https://registry.ollama.ai/v2/")):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=15) as response:
            results[name] = {"url": url, "status": response.status}
    except Exception as error:
        results[name] = {"url": url, "error_type": type(error).__name__, "error": str(error)}

report = {"command": [sys.executable, "benchmarks/probe-local.py", *sys.argv[1:]],
          "harness_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
          "source_commits": {name: subprocess.check_output(["git", "-C", str(sources / name), "rev-parse", "HEAD"], text=True).strip()
                             for name in ("graphiti", "zep-python", "cognee")},
          "versions": {name: importlib.metadata.version(name) for name in ("graphiti-core", "zep-cloud", "cognee")},
          "probes": results}
Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
