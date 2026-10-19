# Optional local semantic retrieval

The default is BM25 with entity-link coverage. Active MiniLM retains the existing
entity-overlap fusion because stronger coverage lowered its hit rate and recall.
To add a learned semantic candidate pool,
install the optional packages beside sessionmem and enable it:

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm install sessionmem @huggingface/tokenizers@0.2.0 onnxruntime-node@1.30.0 @xcidos/genesis-memory-model@0.1.0-alpha.1
npx sessionmem config set semanticSearch true
```

For a global sessionmem installation, use `npm install -g` for the same packages.
`ONNXRUNTIME_NODE_INSTALL=skip` skips optional CUDA downloads; the npm package
already contains the CPU runtime. On PowerShell set
`$env:ONNXRUNTIME_NODE_INSTALL = 'skip'` before the install command.
Developers should also use that variable with `npm ci` to avoid CUDA downloads.
Disable semantic retrieval with `sessionmem config set semanticSearch false`.

Installation fetches packages and weights. Capture and retrieval only load files
from these installed packages; they never download a model, contact a model
server, or send memory text over a network. Missing packages, checksum mismatches,
unsupported native runtimes, and inference errors fall back to BM25 and emit one
diagnostic per service instance. Restart after installing or repairing packages.
Before loading ONNX Runtime, sessionmem sets the process-wide
`ORT_DISABLE_TELEMETRY=1` to suppress its native POSIX telemetry uploader.
The benchmark's `--semantic` mode instead fails if the model cannot load, to
prevent accidentally publishing fallback scores as semantic results.

The encoder is sentence-transformers/all-MiniLM-L6-v2: 384 dimensions, mean pooling,
L2 normalization, and at most 256 WordPiece tokens. Its weights and tokenizer come
from the pinned npm distribution above, whose provenance names upstream revision
`c9745ed1d9f207416be6d2e6f8de32d1f16199bf`. Both files are SHA-256 checked before
loading. The model is by the sentence-transformers contributors, distributed under
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0); see
[model information](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
and the package's provenance README. No competitor code or prompt is included.

Learned vectors are a separate SQLite BLOB index, keyed by memory and complete
model/tokenizer/pooling version. Content edits invalidate vectors; deletes cascade.
Only stored text is embedded, after the configured capture redaction policy.
Capture through `storeMemory` indexes it immediately. Existing memories are
embedded as stored; other write paths are backfilled
on the next semantic query, so the first query on a large existing store can be
slow. Model initialization and indexing cost are distinct from warm retrieval.

Queries perform an exact local cosine scan, take up to 50 semantic candidates,
and union them with FTS candidates. Project, expiry, and supersession filters
apply to both channels; `includeHistory` explicitly includes superseded rows.
Normalized BM25 relevance and positive cosine are blended 2:1 before the existing
entity, recency, importance, and access signals. With no lexical match, cosine
supplies relevance. This weighting follows the measured weakness of dense-only
retrieval; it is not a held-out optimum. Read the measured regressions in
[the comparison](../COMPARISON.md).

Exact scans are intended for small project stores and scale linearly with the
number of vectors. Long memories are truncated to the encoder's token window;
no new chunking or model-based contradiction resolution is implemented.
