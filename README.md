# sessionmem

<p align="center">
  <img src=".github/sessionmem-logo.svg" alt="sessionmem" width="480">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sessionmem"><img src="https://img.shields.io/npm/v/sessionmem.svg" alt="npm version"></a>
  <a href="https://github.com/catfish-1234/sessionmem/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

**Project memory between sessions, stored on your machine.**

```
New session. Claude starts fresh.

WITHOUT sessionmem:
  You explain the stack. The JWT bug from last week.
  The Stripe migration that's halfway done. The billing code to stay away from.
  Same questions. Different day.

WITH sessionmem:
  [warning] JWT blacklist must be checked before issuing new tokens. Fixed PR #47.
  [decision] Stripe migration ~50% done. Do NOT use /lib/billing-v1.
  [fact] Stack: TypeScript, Next.js, Postgres.

  Claude: "Looks like you're mid-Stripe migration. Where do you want to pick up?"
```

`sessionmem` is an MCP server that stores decisions, warnings, and project context across sessions. Claude Code hooks capture supported tool events and load relevant memories automatically. Other hosts use its MCP tools and installed instructions; session automation depends on the host. It works with Claude Code, Cursor, Cline, Codex, Windsurf, and other [MCP](https://modelcontextprotocol.io) hosts.

Default retrieval uses SQLite FTS5 BM25 and entity overlap. An optional
[local MiniLM model](docs/local-semantic.md) adds semantic candidates. Weights are
installed separately; queries make no network calls and fall back to BM25 when
local inference is unavailable. See [measured comparisons](COMPARISON.md) for
quality gains, missed questions, and latency costs.

By default, everything stays on your machine. You don't need an account or a cloud service. Data only leaves your computer if you enable sharing or cloud summarization.

---

## Quickstart

You need a terminal (Command Prompt, Terminal, or PowerShell) and [Node.js](https://nodejs.org), version 20.19+ on the Node 20 line, or 22.13+. Node 22 LTS is recommended. No programming experience is required.

### 1. Install sessionmem

```bash
npm install -g sessionmem
```

### 2. Register it with your AI tool

Run this in your project folder after configuring your AI tool (Claude Code, Cursor, etc.):

```bash
sessionmem install
# Optional: select one host explicitly, including in automation:
sessionmem install --adapter claude-code
# Other names: cursor, cline, codex, windsurf, antigravity, qcoder, generic
```

`install` detects installed hosts from local executables, including from a plain
terminal, and configures every host found. Automatic discovery currently supports
Claude Code on `PATH` or in its standard native install locations. Use
`--adapter <name>` for the other adapters or to override discovery. The existing
`SESSIONMEM_ADAPTER` environment override also works; the flag takes precedence.
If no supported host is found, the command says so and exits nonzero before
creating files. Discovery and configuration work fully offline.

This initializes the database and configures the selected adapters:

- Registers `sessionmem` with your AI tool's MCP host so the host can start it automatically.
- Creates `~/.sessionmem/config.json` with secret redaction enabled and a 90-day retention window, if the file doesn't already exist.
- Adds instructions to the selected host's guidance file, such as `~/.claude/CLAUDE.md` for Claude Code or `~/.codex/AGENTS.md` for Codex. You can re-run the command without duplicating those instructions.
- Installs Claude Code's SessionStart, SessionEnd, and PostToolUse hooks and prints what was configured per host. If a host fails, the remaining hosts are still attempted and the command exits nonzero.
- Enables and starts one per-user login service for `sessionmem watch`. Re-running install updates that registration in place and restarts capture. Capture continues after closing the terminal and starts again at login.

Login capture uses a LaunchAgent in `~/Library/LaunchAgents` on macOS, a
`systemd --user` service on Linux, and a Scheduled Task with a user logon trigger
on Windows. Linux requires systemd and an available user service manager; macOS
requires a GUI login session. If registration or startup fails, install exits
nonzero, preserves completed setup, and prints a repair hint. After fixing the
OS service error, run `sessionmem autostart enable`.

The watcher captures existing and updated Claude Code, Codex CLI, and Cursor
history offline, without API keys. It starts immediately after install; no
manual scan or watch process is required. Hosts outside these three can use MCP
memory tools, but do not have a transcript reader.

### 3. Restart your AI tool

Restart your editor or agent so it loads the MCP registration. Your host starts
`sessionmem run` automatically; running it directly starts a stdio server that
waits for MCP messages, so it can appear to hang in a terminal. For an unknown
host (`generic`), install writes a project-local `.mcp.json`; if your host uses
another format or location, copy its server entry into that host’s MCP config.

After restarting:

- In Claude Code, the installed PostToolUse, SessionEnd, and SessionStart hooks capture supported tool events, summarize them, and load prior memories automatically.
- Codex and Cursor use the auto-started watcher for transcript capture. Install does not wire lifecycle capture hooks for these hosts. Their MCP tools and installed instructions provide recall and explicit memory operations.
- Other MCP hosts use sessionmem's tools and installed instructions; automatic transcript capture requires a supported transcript reader.

Check the installation offline:

```bash
sessionmem doctor
# For an explicitly selected host:
sessionmem doctor --adapter claude-code
```

---

## Table of Contents

- [What problem does this solve?](#what-problem-does-this-solve)
- [How is sessionmem different?](#how-is-sessionmem-different)
- [Benchmark results](#benchmark-results)
- [How it works (in plain English)](#how-it-works-in-plain-english)
- [CLI command reference](#cli-command-reference)
- [Privacy, secrets, and your data](#privacy-secrets-and-your-data)
- [Memory rot: keeping memory accurate over time](#memory-rot-keeping-memory-accurate-over-time)
- [Team mode (optional)](#team-mode-optional)
- [Cloud summarization (optional, off by default)](#cloud-summarization-optional-off-by-default)
- [Supported tools](#supported-tools)
- [Further documentation](#further-documentation)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## What problem does this solve?

Most AI coding assistants rely on the current conversation for context. Start a new session and you may need to explain the project's setup, libraries, fixed bugs, and design decisions again.

`sessionmem` keeps short notes between sessions:

1. While you work, it captures session events.
2. At session end, it summarizes decisions, warnings, and useful facts into stored memories.
3. At the next session start, it loads the most relevant memories within a small token budget.

Claude Code runs these steps through the installed hooks. Other hosts need their
agent to call the MCP memory and lifecycle tools; the installed guidance explains
how to do that.

---

## How is sessionmem different?

Compared with projects such as *claude-mem* and other cloud or Claude-only memory tools, `sessionmem` focuses on local storage and support for multiple MCP hosts:

| | **sessionmem** | Typical cloud/Claude-only memory tools |
|---|---|---|
| **Where is data stored?** | A single SQLite file on your computer (`~/.sessionmem/memories.db`) | Often a hosted service, a cloud vector database, or a separate server process you have to run |
| **Account / sign-up required?** | No | Sometimes |
| **Which AI tools does it work with?** | Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and any other MCP-compatible host | Usually just one specific tool (commonly Claude Code only) |
| **Secret redaction** | Built in, on by default. API keys, tokens, passwords, and private keys are scrubbed before anything is saved. | Often not handled, or left to the user |
| **Token budget control** | Injected memories are trimmed to a small, fixed token budget (see benchmarks below) | Varies, often unbounded |
| **Old/stale memory cleanup** | Built-in retention policy automatically prunes old memories (configurable, on by default) | Often no automatic cleanup ("memory rot") |
| **Team sharing** | Optional, via a shared folder you already control (network drive, synced directory). No server needed. | Usually requires a shared hosted backend |
| **Offline-capable** | Yes. Works with no network connection by default. | Usually requires network access to the memory service |

The SQLite file is easy to inspect, back up, or delete, and you can use it across AI tools from different vendors.

---

## Benchmark results

`npm run benchmark` evaluates conversational retrieval on the committed LoCoMo
corpus: 10 conversations, 272 sessions, 5,882 turns, and 1,527 scored questions.
It captures dialogue through the public `storeMemory` API and asks the original
questions through `retrieveMemories`, fully offline with no API keys.

The evaluation reports hit rate, precision, recall, complete-evidence retrieval,
and latency. Production retrieval uses offline BM25 ranking with English stemming;
conversational questions test recall beyond exact copies of memory text.
See [benchmark results](docs/benchmark.md) and the
[methodology, dataset license, and metric definitions](benchmarks/README.md).

```bash
npm run build
npm run benchmark
npm run benchmark -- --output benchmarks/results/locomo.json
```

---

## How it works (in plain English)

```
        ┌──────────────────────────────────────────────┐
        │                  Your AI tool                 │
        │   (Claude Code, Cursor, Codex, Cline, ...)    │
        └───────────────────────┬──────────────────────┘
                                 │
                     ┌───────────▼───────────┐        ┌──────────────┐
                     │   sessionmem adapter   │        │ sessionmem   │
                     │ (translates for your   │        │     CLI      │
                     │   specific AI tool)    │        │ (you type    │
                     └───────────┬───────────┘        │  commands)   │
                                 │                     └──────┬───────┘
                                 ▼                            │
                     ┌──────────────────────────────────────────────┐
                     │              sessionmem core engine           │
                     │  watches sessions · writes summaries ·        │
                     │  finds relevant memories · trims to fit       │
                     └───────────────────────┬──────────────────────┘
                                              │
                                              ▼
                     ┌──────────────────────────────────────────────┐
                     │         One SQLite file on your computer      │
                     │     ~/.sessionmem/memories.db                 │
                     └──────────────────────────────────────────────┘
```

- **Adapters** connect each AI tool to sessionmem. Supporting another tool doesn't require changing the memory engine.
- **The core engine** stores memories, ranks their relevance, and selects what fits in the next session's context budget. Every adapter uses the same engine.
- **The database** is a local file. You can back it up, move it, inspect it, or delete it.

See [`docs/architecture.md`](docs/architecture.md) for the technical overview.

---

## CLI command reference

| Command | What it does |
|---------|--------------|
| `sessionmem install [--adapter <name>]` | Detect installed hosts, configure integrations, write default config, and enable login capture; the flag selects one host. |
| `sessionmem doctor [--adapter <name>]` | Check the store, schema, auto-start, binary paths, capture freshness, transcript discovery, hooks, MCP wiring, and canary recall offline; print PASS/FAIL and repair hints. |
| `sessionmem autostart enable\|disable\|status` | Start login capture, stop and unregister it, or inspect its registration and binary paths. |
| `sessionmem uninstall [--adapter <name>] [--purge]` | Stop and unregister login capture, then remove sessionmem from the selected host. `--purge` also deletes the local database. |
| `sessionmem run` | Start the MCP server. |
| `sessionmem ui [--port N]` | Open the local read-only web viewer (default port 3777). |
| `sessionmem ping` | Check the local version and database reachability. |
| `sessionmem search <query> [--limit <n>] [--include-history]` | Search current memories by text query (limit 1–100, default 10). Include superseded facts with `--include-history`. |
| `sessionmem list` | List up to 200 recent memories for the current project; warns when truncated. |
| `sessionmem entities [--project <id>] [--json]` | List extracted entities, typed relations, and their source memory IDs. Defaults to the current project. |
| `sessionmem history [--project <id>] [--json]` | List supersession chains with old/new values, source memory IDs, reasons, and timestamps. |
| `sessionmem show <id>` | Show memory details (content capped at 2000 characters; use export for full content). |
| `sessionmem forget <id> [--force]` | Delete a memory by ID. |
| `sessionmem export [path]` | Export all current-project memories to JSON (default `~/.sessionmem/export-YYYY-MM-DD.json`). |
| `sessionmem import <path> [--merge]` | Import up to 1000 valid records from UTF-8 JSON into the current project. Existing IDs are preserved, including with `--merge`; invalid records are skipped with warnings. |
| `sessionmem scan [--host <host>] [--transcripts-dir <path>]` | Import existing Claude Code, Codex CLI, and Cursor transcripts into local session memories. Reports files found, sessions imported, memories created, skips, and errors. |
| `sessionmem watch [--once] [--interval <seconds>] [--host <host>] [--transcripts-dir <path>]` | Capture new or updated Claude Code, Codex CLI, and Cursor transcripts. Polls every 5 seconds by default; `--once` runs a single sweep. |
| `sessionmem stats` | Show memory statistics for the current project. |
| `sessionmem savings [--json]` | Show token savings from compression and injection, with percentage. |
| `sessionmem redact-scan [--apply]` | Scan stored memories for secrets; `--apply` redacts in place. |
| `sessionmem retention prune [--force] [--days <n>]` | Prune old memories (dry-run by default). |
| `sessionmem config get <key>` / `config set <key> <value>` | Read and write policy config. |
| `sessionmem team enable <path>` / `team disable [--remove-team-memories]` / `team status` | Manage shared-path team memory mode. |
| `sessionmem sync` | Push local memories and pull teammate memories via the shared path. |
| `sessionmem browse [--project <id>]` | List projects or preview up to 50 recent memories from one project. |
| `sessionmem dedupe [--apply] [--threshold <n>]` | Preview duplicate memories; `--apply` deletes them (threshold >0–1, default 0.85). |
| `sessionmem re-embed` | Refresh memories with stale embedding versions. |
| `sessionmem session-start` | Print prior context as Claude Code SessionStart hook JSON. |
| `sessionmem ingest-hook` | Read a Claude Code PostToolUse JSON payload from stdin and capture supported tool events. |
| `sessionmem session-end` | Summarize ingested events and apply retention pruning; reads the hook session ID from stdin. |

Use `sessionmem --help` or `sessionmem <command> --help` for options, and
`sessionmem --version` for the installed version. Destructive commands require
`--force`, `--apply`, or `--purge` as shown above. `team disable` preserves
teammate memories unless `--remove-team-memories` is passed.

The default database is `~/.sessionmem/memories.db`. Set `SESSIONMEM_DB_PATH`
to use another file; its parent directories are created automatically and the
default directory is not created by database commands. Server logs are written
to `logs/mcp.log` beside the selected database (disabled for `:memory:`). Config remains at
`~/.sessionmem/config.json`. `uninstall --purge` deletes the selected database.
Quote paths containing spaces (for example `"C:\Users\Ada Lovelace\memory.db"`
on Windows). In JSON config files, use forward slashes or escaped backslashes
for Windows paths. Imports accept CRLF and a UTF-8 BOM; convert other encodings to UTF-8.

`SESSIONMEM_PROJECT_ID` pins the project bucket (useful when moving a repository);
otherwise it is derived from the repository root or working directory.
`SESSIONMEM_ADAPTER` selects the install/doctor/uninstall host unless `--adapter` is set.
`SESSIONMEM_DEBUG=1` enables ingest-hook diagnostics on stderr.

### Inspect memories in your browser

```bash
sessionmem ui
sessionmem ui --port 8080
sessionmem ui --port 0  # Pick an available port
```

The command prints its URL and opens your default browser. It binds only to
`127.0.0.1`, needs no authentication, and serves all assets locally using Node's
built-in HTTP server. No external services, CDNs, or additional runtime dependencies
are used. If browser launch is unavailable, open the printed URL manually. Press
Ctrl-C to stop the server and close its database connection.

The viewer starts on the current project, with a selector for other projects in
the same store. Browse saved memories, search through the existing recall path,
inspect extracted entities and relations with their source memories, and follow
supersession chains with old/new values, source IDs, assertion times, detection
times, and partial/full status. Search returns up to 50 results and defaults to
current facts; select **Include superseded facts in search** to recall history.
Browsing lists all saved records, including superseded and expired ones, in pages
of 50. Source IDs open full memory details. Entity visibility and history links
use the same rules as `sessionmem entities` and `sessionmem history`.

The database is opened read-only. Browsing and on-demand search do not increment
access counts, migrate the schema, or change memories. Only HTTP GET and HEAD are
accepted; no write, delete, or edit routes are exposed. Responses are not cached,
and cross-origin browser requests and unexpected Host headers are rejected. Run
`sessionmem ping` first to initialize a missing store or upgrade an older schema.
The usual `SESSIONMEM_DB_PATH` and `SESSIONMEM_PROJECT_ID` overrides
apply. Anyone with access to this computer can read the local viewer while it is
running; stop it when finished inspecting private memories.

### Import existing sessions and watch for new ones

When a fact changes, sessionmem can link its replacement locally. For example, “I use VS Code” followed by “I switched to Neovim” supersedes the earlier editor choice. Recall excludes fully superseded memories by default. `retrieveMemories` accepts the optional `includeHistory: true`; `sessionmem search --include-history` searches earlier facts too. `sessionmem history` shows what replaced what. The old memory stays available through show, list, and export.

Detection uses deterministic entity/relation rules, shared purpose words, a small tool-category vocabulary, and explicit negation or replacement phrases. It needs no API or model. Unfamiliar wording can be missed, and ambiguous changes can be misclassified. A memory with independent claims remains searchable while any claim is current; history labels these partial supersessions. See [supersession details](docs/architecture.md#contradiction-and-supersession).

Install starts capture for existing history and new sessions automatically. For a manual import or a foreground diagnostic run:

```bash
sessionmem scan
sessionmem watch --once
sessionmem watch --interval 10
sessionmem scan --host cursor
```

Both commands sweep all detected transcript histories by default:

- Claude Code: `~/.claude/projects/**/*.jsonl`.
- Codex CLI: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- Cursor: `User/globalStorage/state.vscdb` under
  `~/Library/Application Support/Cursor` on macOS, `~/.config/Cursor` on Linux,
  or `%APPDATA%/Cursor` on Windows.

Missing history directories are allowed. Use `--transcripts-dir "/path/to/history"`
to select another transcript tree; each JSONL file's host is detected from its records.
For Cursor, the override accepts its `User` directory or a `state.vscdb` path.
Use `--host cursor`, `--host codex`, or `--host claude-code` to select one host,
including when using an override. A Cursor User directory or `.vscdb` file is
also detected without `--host`. Files that do not match a supported format, or
the selected host, produce an explicit `unsupported format` error.

Both commands work offline without API keys and always use the local summarizer,
even if cloud summarization is enabled elsewhere. `sessionmem doctor` checks
transcript discovery for all three hosts, parses JSONL samples, and validates
Cursor's composer indexes and message rows when history is present.

Transcript user/assistant text, supported Claude tool uses (Bash, Edit, Write,
MultiEdit), and Codex function calls pass through the existing event-ingestion,
redaction, and session-summary pipeline. Codex tool events retain the native tool
name and `call_id`. Encrypted `agent_message` payloads and obvious injected machine
blocks, including plugin catalogues and environment context, are excluded. Each
session gets one summary memory, including short sessions with only one event.
Updated sessions refresh that summary. Project buckets come from
each Claude transcript's `cwd`, Codex `session_meta.payload.cwd`, or Cursor's
workspace path, using the repository root when available; the directory where you run scan/watch does not
select the project. `SESSIONMEM_PROJECT_ID` can explicitly pin all imports to one
bucket. Transcripts without capturable events are skipped. Claude transcripts
without a working directory are also skipped; Codex session metadata must contain
an ID and working directory. Nested subagent files get separate session summaries.
Summary memories record `sourceAdapter` as `claude-code`, `codex`, or `cursor`
according to the transcript host. Cursor session IDs come from `composerId`.

Cursor stores messages in `cursorDiskKV` bubble rows in its global SQLite
database. The importer supports workspace `composer.composerData` indexes
(Cursor 2.6 and earlier) and the central `composer.composerHeaders` index
(Cursor 3.0 and later). It captures up to 4,000 characters of user/assistant text
per bubble and excludes tool-only bubbles and internal tool/code fields. Missing
tables, index keys, or required conversation data produce an explicit
`unsupported format for cursor` error.

Cursor databases are never written. Each sweep copies the database and its WAL
to a private temporary directory, checking for concurrent changes during the
copy. SQLite opens the copy read-only, using immutable mode when URI support is
available and there is no WAL to replay. Cursor's live database is never opened by SQLite. Busy
copies are reported and retried. Each sweep reads a fresh snapshot; per-composer
checkpoints skip unchanged messages, and streamed bubble updates refresh the
existing event without duplicating it.

Codex resumes create new rollout files. Files with the same session ID are grouped,
and replayed events are deduplicated across files, sweeps, and restarts. A Codex
sub-agent keeps its own `session_meta.payload.id`, even when `parent_thread_id`
points to a parent session.

Re-running either command does not duplicate memories or transcript events.
File and composer checkpoints live in the selected memory database, and unchanged
files or composers are skipped across restarts. For Cursor, `files found` counts
global databases, and `skipped` counts unchanged or empty composers.
Stable event IDs also make interrupted imports safe to
retry. Partial or malformed JSONL lines are reported and retried on later sweeps;
valid events in the same file can still be captured. A single sweep exits with
status 1 if it encounters errors. The daemon keeps running and retries errors.

`watch` prints its first sweep and subsequent imports or errors. A manual run
stays in the foreground until SIGINT or SIGTERM. Login capture uses the same
watcher with an absolute Node executable and absolute sessionmem entry point;
it does not need a shell, a TTY, or your interactive PATH.

Control login capture explicitly:

```bash
sessionmem autostart status
sessionmem autostart disable
sessionmem autostart enable
```

`enable` updates one registration and starts capture immediately. `disable` stops
the registered watcher and removes its login registration, preserving memories.
The next `sessionmem install` enables it again. This control affects the login
watcher; Claude Code hooks and explicit MCP memory tools remain active.

Registrations:

| OS | Registration |
| --- | --- |
| macOS | `~/Library/LaunchAgents/io.sessionmem.watch.plist` |
| Linux | `~/.config/systemd/user/sessionmem-watch.service` |
| Windows | Scheduled Task `sessionmem-watch-<user-home-hash>`, for the current user only |

Capture output and failures are appended with timestamps to `logs/watch.log`
beside the selected database (default `~/.sessionmem/logs/watch.log`). The
watcher also writes `memories.db.watch-checkpoint.json` beside the default store
after each completed sweep. Doctor checks this checkpoint's age, capture errors,
and transcript checkpoint count; unchanged history and an empty history are
healthy when the watcher continues completing sweeps. A checkpoint older than
two minutes fails the default 5-second watcher check. For a custom polling
interval, the limit is the greater of two minutes and three intervals.

`SESSIONMEM_DB_PATH` selected at install or enable is saved as an absolute
watcher argument. Run enable with that variable again to switch stores. The
policy config remains `~/.sessionmem/config.json`. After moving sessionmem or
changing Node versions, run `sessionmem autostart enable` to update the absolute
paths. For failures before the watcher can open its log, inspect `launchctl
print gui/<uid>/io.sessionmem.watch`, `journalctl --user -u
sessionmem-watch.service`, or Windows Task Scheduler's task history.

### Uninstall

```bash
sessionmem uninstall --adapter claude-code
# Also delete the selected memory database:
sessionmem uninstall --adapter claude-code --purge
```

Uninstall stops capture and removes the login registration before removing MCP
configuration, Claude hooks, and agent guidance for the selected host. It keeps
the database, config and logs by default. Use the same `SESSIONMEM_DB_PATH` as
install when selecting a custom database to purge. If stopping or unregistering
the watcher fails, uninstall reports the OS error and leaves the database intact.
For multiple installed hosts, repeat uninstall with each adapter to remove its
MCP configuration and guidance.

---

## Privacy, secrets, and your data

Storage, retrieval, and summarization run locally by default. There is no account, telemetry, or hosted memory service. Settings live in `~/.sessionmem/config.json`.

### Secrets are scrubbed automatically

Before saving memory content, `sessionmem` replaces common secret patterns with `REDACTED`:

- Email addresses
- API keys (`sk-...`, AWS `AKIA...`, GitHub `ghp_...`/`gho_...`, etc.)
- Bearer tokens and JWTs
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Connection-string style secrets (`password=...`, `secret=...`)

Redaction is on by default. To scan and clean up older memories:

```bash
sessionmem redact-scan          # see what would be redacted
sessionmem redact-scan --apply  # actually redact in place
```

Full details: [`docs/privacy-and-retention.md`](docs/privacy-and-retention.md).

---

## Memory rot: keeping memory accurate over time

Old decisions and duplicate facts can accumulate in a memory store, causing the assistant to use outdated information. This is sometimes called "memory rot."

`sessionmem` handles it through retention, ranking, and sync rules:

1. **Retention pruning**: memories older than a configurable window (90 days by default) are eligible for deletion. A lightweight check runs at session end. You can also run it manually:

   ```bash
   sessionmem retention prune          # dry run - shows what *would* be deleted
   sessionmem retention prune --force  # actually deletes
   ```

2. **Importance-weighted ranking**: retrieval ranks memories by offline BM25 lexical relevance, entity overlap, recency, and importance. Older, less important notes rank lower even before they are pruned.

3. **Token-budgeted injection**: only the highest-ranked memories are loaded, trimmed to a small token budget (see [benchmarks](#benchmark-results)). The context stays within that budget as the store grows.

4. **Conflict resolution in team mode**: merging teammate memories uses last-write-wins by id to avoid stale duplicates and keeps the higher importance score so a warning isn't downgraded.

The [conversational benchmark](benchmarks/README.md) measures retrieval quality separately from retention and startup token budgets.

Export your memories before pruning if you want to keep a copy:

```bash
sessionmem export
```

---

## Team mode (optional)

To share decisions and warnings across your team's AI assistants, point `sessionmem` at a folder everyone can read and write, such as a network drive or synced directory:

```bash
sessionmem team enable <shared-path>
sessionmem sync
```

- Team mode is off by default. Nothing is shared until you enable it.
- Memories are shared as files in that folder; no server is needed.
- Teammate memories appear with an `author:` prefix identifying their source.
- Redaction runs on every pulled memory using your redaction policy.

Full details, including the trust model: [`docs/team-mode.md`](docs/team-mode.md).

---

## Cloud summarization (optional, off by default)

By default, session summaries are created locally, with no API calls.

To use Claude's API for higher-quality summaries, set `allowCloudSummarization=true` and provide an `ANTHROPIC_API_KEY`. If cloud summarization fails after retries, sessionmem uses local summarization. Failures are recorded for diagnosis; see the configuration guide below.

Details: [`docs/cloud-summarization.md`](docs/cloud-summarization.md).

---

## Supported tools

`sessionmem` works with any MCP-compatible host, including:

- Claude Code
- Cursor
- Codex
- Cline
- Windsurf
- Antigravity
- QCoder

Other tools that implement the [Model Context Protocol](https://modelcontextprotocol.io) can connect too.

---

## Further documentation

- [Architecture](docs/architecture.md): how the core engine, adapters, CLI, and SQLite storage fit together.
- [Benchmark](docs/benchmark.md): conversational retrieval results and reproduction steps.
- [Privacy and retention](docs/privacy-and-retention.md): secret redaction, retention pruning, and config.
- [Team mode](docs/team-mode.md): shared-path team memory.
- [Cloud summarization](docs/cloud-summarization.md): the opt-in cloud summarization path.
- [Migration](docs/migration.md): the SQLite migration system and version-upgrade policy.
- [Troubleshooting](docs/troubleshooting.md): install failures, adapter issues, and `better-sqlite3` native-build problems.

---

## Troubleshooting

For install failures, adapter issues, missing session data, or `better-sqlite3` native-build problems, see [`docs/troubleshooting.md`](docs/troubleshooting.md).

Start with offline diagnostics:

```bash
sessionmem doctor
sessionmem doctor --adapter claude-code  # explicit host override
```

`doctor` reports a separate PASS or FAIL for the memory store, schema, transcript
discovery for Claude Code, Codex and Cursor, login auto-start registration,
registered binary paths, watcher capture checkpoint freshness, hook definitions
shipped with the current version, configured MCP command, and a canary
write/recall. It exits nonzero if any check fails and prints fix hints,
including exact commands for safe repairs. It does not create a missing store or
apply migrations. Its temporary canary is isolated from your projects and rolled
back even on failure. The MCP check starts the installed local command and verifies
its version, tools, and a stats response; it does not require a running agent.

Use `sessionmem ping` to initialize a missing store or apply pending schema
migrations, or `sessionmem install --adapter claude-code` to refresh Claude Code's
MCP registration and hooks. Use `sessionmem autostart enable` to refresh the
login service and absolute binary paths; inspect `logs/watch.log` beside the
database when capture fails. Run repairs with the same `SESSIONMEM_DB_PATH` as
doctor when using a custom store.

If `stats` shows `sessions: 0` after real work, see [“0 sessions” / no session data recorded](docs/troubleshooting.md#0-sessions--no-session-data-recorded). Memories are keyed to the **repository root**, so every directory inside one repo shares a bucket; outside a repo the working directory itself is the key.

To check database access and memory counts:

```bash
sessionmem ping     # can the local database be opened?
sessionmem stats    # is data being stored?
```

---

## FAQ

**How do I give Cursor, Cline, or Windsurf memory between sessions?**
Install sessionmem (`npm i -g sessionmem`), then run `sessionmem install` in your project. Use `--adapter cursor`, `--adapter cline`, or `--adapter windsurf` when auto-detection cannot identify your host.

**How do I give Claude Code persistent memory?**
Use the same install steps above. sessionmem also ships as a Claude Code plugin (the `.claude-plugin` directory in the repo) for Claude Code's native plugin system.

**Is there a local MCP memory server that works offline with no API key?**
Yes. sessionmem stores memories in a single SQLite file at `~/.sessionmem/memories.db` and works offline by default. Sharing and cloud summarization are optional and off by default.

**How is sessionmem different from claude-mem?**
sessionmem works with Claude Code, Cursor, Cline, Codex, Windsurf, Antigravity, QCoder, and other MCP hosts. It redacts secrets (API keys, tokens, JWTs) by default, prunes old memories automatically, and includes reproducible benchmarks.

**Does sessionmem send my code to the cloud?**
No. Nothing leaves your machine by default. The optional cloud summarization path is opt-in and off by default.

**How do I see how many tokens sessionmem saved me?**
Run `sessionmem savings` to see a breakdown of storage compression (raw session tokens vs memory tokens) and injection efficiency. Add `--json` for machine-readable output.

---

## Security

See the [security policy](SECURITY.md) for supported versions, private vulnerability
reporting through GitHub security advisories, and response expectations.

---

## Contributing

Issues and pull requests are welcome. The codebase is TypeScript, tested with [Vitest](https://vitest.dev), and linted with ESLint:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run lint
```

**MCP config for local development:** Clone the repository, build it, copy
`.mcp.json.example` to `.mcp.json`, and replace the example path with the absolute
path to your checkout’s `dist/cli/index.js`. This runs your local build.
`sessionmem install` registers the `sessionmem` executable on PATH instead. The `.mcp.json` file is gitignored because it contains machine-specific paths.

---

## License

[MIT](LICENSE)
