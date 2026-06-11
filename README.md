# sessionmem

`sessionmem` is a local-first MCP memory layer for coding agents. It gives your agent cross-session, cross-platform memory: it captures session context, summarizes key outcomes, stores semantic embeddings locally in SQLite, and injects only the relevant memories back at the start of the next session — so the agent remembers the right past decisions at the right time without you re-explaining context. It works across Claude Code, Codex, Cursor, Cline, Windsurf, Antigravity, QCoder, and any other MCP-compatible host.

It runs entirely on your machine. There is no hosted memory service: storage, retrieval, and summarization all default to local-only, governed by `~/.sessionmem/config.json`.

## Quickstart

Install the package, then install `sessionmem` into your current MCP host and start the server.

Install from npm:

```bash
npm install -g sessionmem
```

Register `sessionmem` with the MCP host in the current directory (this writes `~/.sessionmem/config.json` with safe defaults if it does not already exist):

```bash
sessionmem install
```

Start the MCP server (your host normally launches this for you once installed):

```bash
sessionmem run
```

That's it. From here your agent captures sessions automatically and injects relevant memory at the next session start, under a small token budget.

## CLI Command Reference

| Command | What it does |
|---------|--------------|
| `sessionmem install` | Register sessionmem with the current MCP host and write default config. |
| `sessionmem uninstall [--purge]` | Remove sessionmem from the host. `--purge` also deletes the local database. |
| `sessionmem run` | Start the MCP server. |
| `sessionmem ping` | Check server connectivity. |
| `sessionmem search <query> [--limit <n>]` | Search memories by semantic query. |
| `sessionmem list` | List all memories for the current project. |
| `sessionmem show <id>` | Show full details of a memory. |
| `sessionmem forget <id> [--force]` | Delete a memory by ID. |
| `sessionmem export [path]` | Export memories to a JSON file. |
| `sessionmem import <path> [--merge]` | Import memories from a JSON file. |
| `sessionmem stats` | Show memory statistics for the current project. |
| `sessionmem redact-scan [--apply]` | Scan stored memories for secrets; `--apply` redacts in place. |
| `sessionmem retention prune [--force] [--days <n>]` | Prune old memories (dry-run by default). |
| `sessionmem config get <key>` / `config set <key> <value>` | Read and write policy config. |
| `sessionmem team enable <path>` / `team disable` / `team status` | Manage shared-path team memory mode. |
| `sessionmem sync` | Push local memories and pull teammate memories via the shared path. |

## Local-first and privacy

All memory lives on your machine. Policy is governed by `~/.sessionmem/config.json` — including secret redaction (on by default, scrubbing API keys and tokens before they are stored) and a retention window that prunes old memories. Cloud summarization is strictly opt-in. See the privacy doc below for the full data-flow and controls.

## Documentation

- [Architecture](docs/architecture.md) — how the core engine, adapters, CLI, and SQLite storage fit together.
- [Troubleshooting](docs/troubleshooting.md) — install failures, adapter issues, and `better-sqlite3` native-build problems.
- [Migration](docs/migration.md) — the SQLite migration system and the version-upgrade policy.
- [Privacy and retention](docs/privacy-and-retention.md) — secret redaction, retention pruning, and config.
- [Team mode](docs/team-mode.md) — shared-path team memory.
- [Cloud summarization](docs/cloud-summarization.md) — the opt-in cloud summarization path.
