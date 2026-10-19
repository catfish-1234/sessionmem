# Retrieval evaluation artifacts

See [method and results](../../retrieval-gaps.md). Each compressed run preserves
all original question IDs, evidence, retrieved IDs and scoring outputs. The
summary and regression reports preserve every lost hit and partial evidence loss.
No failed category or individual regression is excluded.

`main-before` and `hybrid-before` were measured first on unchanged main at 1.7.0.
`main-after` and `hybrid-after` use unchanged default settings on this branch.
Other runs enable temporal retrieval, entity linking, or both. The run manifest
records exact commands, checksums, source and build digests. `source_commit` in a
run is the base commit because the changes were evaluated in the working tree.
The manifest identifies the evaluated implementation separately.

`preliminary-entity` and `preliminary-combined` preserve measurements before a
correctness fix: scoring had incorrectly inherited the candidate-admission cap.
That cap now applies only to additional candidates, and a test verifies that all
existing candidates retain their linked-entity scores. Weights were not changed.
These preliminary runs are not substituted for final results.

`disclosure.json.gz` contains per-question token counts for the actual tool text,
not prompt templates or estimates. No relevance label chooses a detail to fetch.
`public-docs.json` pins the three public READMEs used to identify approaches; no
competitor implementation or prompt is redistributed here.

The artifacts contain derived [LoCoMo](../../data/provenance.json) annotations.
Dataset attribution and **CC BY-NC 4.0** terms remain in
[the dataset license](../../data/LICENSE.txt) and
[benchmark provenance](../../README.md#data-provenance-and-license). The repository
MIT license does not relicense the dataset or its annotations.

The selected default uses coverage for BM25 and the original fusion with active
MiniLM. The new source-informed matrix is described in
[the source notes](../../retrieval-source-notes.md). Source references are in
`source-audit.json`; no competitor source or prompt was adapted.
