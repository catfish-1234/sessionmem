# Registry listing — draft for review

**Status: DRAFT FOR REVIEW. This is proposed listing text only; it has not been
submitted to any MCP or tool registry.**

## Name

sessionmem

MCP identifier: `io.github.catfish-1234/sessionmem`

## One-line description

An offline MCP memory server that keeps coding-agent decisions, warnings, and
project context in local SQLite across sessions.

## Features

- Persistent project memory through MCP tools for storing, retrieving, listing,
  inspecting, and forgetting memories.
- Claude Code hooks capture supported tool events, summarize sessions locally,
  and load relevant prior context automatically. Other MCP hosts use memory
  tools and installed guidance; automatic lifecycle capture depends on the host.
- Adapters for Claude Code, Codex, Cursor, Cline, Windsurf, Antigravity, QCoder,
  and generic MCP hosts.
- Offline BM25 retrieval with English stemming, entity overlap, recency, and
  importance; startup context is trimmed to a token budget.
- Deterministic entity/relation extraction and supersession history. Fully
  replaced memories are excluded from normal recall, with explicit history
  lookup available. These language rules have limited coverage.
- Offline `scan`/`watch` commands for existing and new Claude Code transcripts.
- Local SQLite storage, default secret-pattern redaction, configurable retention,
  JSON export/import, and offline installation diagnostics with `sessionmem doctor`.
- A committed LoCoMo corpus and reproducible offline evidence-retrieval runner;
  see the [comparison and evaluation limits](../COMPARISON.md#evaluation-and-measured-results).

## Install and connect

Requires Node.js `^20.19.0 || >=22.13.0`.

```bash
npm install -g sessionmem
```

From the project directory, register it with a configured host:

```bash
sessionmem install
```

Automatic discovery currently detects Claude Code. Select other adapters
explicitly, for example:

```bash
sessionmem install --adapter codex
```

Restart the host after registration. The host launches the stdio server with
`sessionmem run`; this is the server command for registries that request one.
See the [quickstart](../README.md#quickstart) for host-specific setup.

## Offline guarantee

**The local memory pipeline requires no API keys and makes no network calls.**
Capture, local summarization, entity/relation extraction, supersession, and
retrieval run on the user's machine without downloading models. Memories are
stored by default in `~/.sessionmem/memories.db`. No hosted memory account or
service is needed. The coding agent's own model connection is separate.

Package installation may require network access or an offline package cache.
Explicitly enabling [cloud summarization](cloud-summarization.md) with both its
configuration flag and an Anthropic API key sends a redacted transcript to
Anthropic. Optional [team sharing](team-mode.md) uses a user-selected shared
folder. These opt-in paths are outside the local-only guarantee. The optional
read-only viewer uses loopback HTTP with locally bundled assets and no external
services or CDNs.

## Links and license

- [Source and setup](https://github.com/catfish-1234/sessionmem)
- [npm package](https://www.npmjs.com/package/sessionmem)
- [Comparison](../COMPARISON.md)
- [Privacy and retention](privacy-and-retention.md)
- [MIT license](../LICENSE); the bundled LoCoMo dataset has a separate
  [CC BY-NC 4.0 license](../benchmarks/data/LICENSE.txt).

Review the wording and destination-specific registry fields before any future
submission. This draft does not claim registry acceptance or verification.
