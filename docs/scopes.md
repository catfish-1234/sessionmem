# Scopes

A scope is an optional local context label on a session, a memory and each of
that memory's extracted entity associations. A label can be a project or context
name such as `release` or `research`. Labels are trimmed, case-sensitive strings
of 1 to 160 characters without control characters. `null` means unlabelled.

Existing project boundaries still apply. Selecting all scopes does not search
other projects. Omitting scope arguments preserves the previous candidates,
ranking, response fields and compact retrieval limits. No scope metadata is
added to default retrieval responses or startup text.

## Capture

For a new session, capture uses the real working directory's final name, with
symlinks resolved where possible. Missing directories still use their final
name. A headless capture without a directory falls back to the supplied project
ID. No useful directory or project name leaves the scope NULL.

Capture requests support `scope` and `workingDirectory`. An explicit scope,
including NULL, overrides the session's label. Otherwise an established session
keeps its label, including an established NULL label. New sessions use the
operator's `SESSIONMEM_SCOPE` or configured `scope` default before detection.
The transcript scanner passes each transcript's directory rather than using the
watcher's working directory. User overrides are available through:

```bash
sessionmem scan --scope release
sessionmem watch --scope release
sessionmem config set scope release
sessionmem scopes --json
```

The environment/config settings are defaults for new sessions. Explicit
per-request or scan/watch overrides also work on an existing session. Changing a
session label affects subsequent writes; existing memory labels are snapshots.
Rescanning with an explicit scope reuses event IDs and the existing summary,
updates that summary's label and rebuilds its entity associations. It does not
duplicate events. Without an override, old transcript checkpoints stay valid;
upgrading does not replay unchanged captures or refresh their ranking dates.

Entity associations inherit the memory label on insertion, replacement and
content rewrites. Batch capture and both summary paths preserve scope. Exports
include non-NULL memory labels and imports preserve supplied labels. Old exports
without labels remain unlabelled and do not overwrite an established session's
label. The scopes command reports stored metadata counts, including records
awaiting retention cleanup.

Each session has one current label. Its summary still covers the whole session;
relabeling does not split historical events into separate summaries.

## Retrieval

Scope arguments on full retrieval and compact index search are:

| Argument | Behavior |
| --- | --- |
| Omitted `scope` | All scopes within the current project; no scope scoring |
| `scope: "release"` | Filter to exactly that label |
| `scope: null` | Filter to unlabelled memories |
| `scopeMode: "filter"` | Explicit filter mode; requires a scope argument |
| `scopeMode: "boost"` | Keep other scopes and favor the supplied label; requires a scope argument |

```json
{"query":"deployment","scope":"release","scopeMode":"filter"}
```

Filters apply before lexical, entity and semantic candidate limits and before
normalizing entity scores. They preserve project, expiry and history rules.
Compact search shares the same ranking path. Timeline and get-by-ID requests
also accept an optional `scope` filter; a mismatched anchor or ID returns
`NOT_FOUND`. A timeline retains chronological ordering. Its scope filter applies
before limiting rows, and search/timeline limits and previews remain unchanged.

Boost mode reranks the existing candidate pool. Matching candidates get up to
0.10 extra relevance, capped at relevance 1. With relevance weighted at 0.60,
the final score contribution is at most 0.06. Temporal fusion can attenuate it
to 0.054. Recency, importance, lexical/semantic relevance and optional entity
boosts still apply; a recent unmatched memory can win. A candidate at relevance
1 receives no additional score. Scope boost does not admit additional records
outside the existing candidate pool.

```bash
sessionmem search "deployment" --scope release
sessionmem search "deployment" --scope release --scope-mode boost
sessionmem entities --scope release --json
```

MCP request schemas expose these fields automatically. The local REST API and
typed client accept scope selection for search and scope filters for timeline
and details. In REST query strings, `scope=release` selects a label and an empty
`scope=` selects unlabelled records; the client maps `scope: null` accordingly.
Capture accepts a JSON scope label or NULL. All matching uses local data.

## Upgrade and limits

Migration 017 runs automatically on first open and only adds schema and indexes.
It registers existing sessions with NULL labels and leaves all old memory and
entity labels NULL. The migration transaction includes every pending version
and runs before persistent journal-mode changes. A failed migration rolls back
the pending upgrade; the original file is preserved and a later open can retry.
The committed v16 database fixture exercises successful upgrades, idempotence,
integrity, foreign keys and byte-identical failures in DELETE and WAL modes.

Directory basenames can coincide or change after moves. Use an explicit label
for a stable shared context. Existing historical scopes are not inferred or
retroactively assigned. Scope selection is exact and uses the existing project
boundary; labels do not change project identity. The LoCoMo evaluation validates
unchanged default retrieval, not scope-specific quality, since that corpus has
no scope relevance annotations. See [measured results](../benchmarks/scopes.md).

Existing supersession rules remain project-wide. A scope filter applies after
that visibility decision; use `includeHistory: true` to inspect an older claim
hidden by a replacement in another context.
