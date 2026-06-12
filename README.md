# sessionmem

**Give your AI coding assistant a memory that lasts beyond one conversation — stored entirely on your own computer.**

`sessionmem` is a local-first memory layer for AI coding assistants (Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and any other tool that speaks [MCP](https://modelcontextprotocol.io)). It watches your coding sessions, writes down the important stuff (decisions, warnings, facts about your project), and quietly reminds the assistant about it the next time you start working — without you having to repeat yourself.

Everything happens on your machine. There is no account to create, no cloud service to trust, and no data that leaves your computer unless you explicitly turn that on.

---

## Table of Contents

- [What problem does this solve?](#what-problem-does-this-solve)
- [How is sessionmem different?](#how-is-sessionmem-different)
- [Benchmark results](#benchmark-results)
- [Quickstart](#quickstart)
- [How it works (in plain English)](#how-it-works-in-plain-english)
- [CLI command reference](#cli-command-reference)
- [Privacy, secrets, and your data](#privacy-secrets-and-your-data)
- [Memory rot: keeping memory accurate over time](#memory-rot-keeping-memory-accurate-over-time)
- [Team mode (optional)](#team-mode-optional)
- [Cloud summarization (optional, off by default)](#cloud-summarization-optional-off-by-default)
- [Supported tools](#supported-tools)
- [Further documentation](#further-documentation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## What problem does this solve?

If you've used an AI coding assistant for more than a day, you've probably hit this:

> You spend twenty minutes explaining your project's setup, the libraries you use, a tricky bug you already fixed, and a decision you made about how authentication should work. The assistant nods along, helps you out... and then in your **next session**, it has forgotten all of it. You explain everything again.

This happens because most AI assistants only "know" what's inside the current conversation. Once that conversation ends, the context is gone.

`sessionmem` fixes this by sitting quietly between your assistant and your project:

1. While you work, it **captures** what happens in the session.
2. When the session ends, it **summarizes** the important parts — decisions made, warnings, useful facts — into short, durable notes.
3. The next time you start a session, it **reminds** the assistant of the most relevant notes, automatically, in a small amount of text.

You don't run any of these steps yourself. Once installed, it just works in the background.

---

## How is sessionmem different?

There are other "memory for Claude" projects out there (for example, tools like *claude-mem* and similar community projects). Here's what sets `sessionmem` apart:

| | **sessionmem** | Typical cloud/Claude-only memory tools |
|---|---|---|
| **Where is data stored?** | A single SQLite file on your computer (`~/.sessionmem/memories.db`) | Often a hosted service, a cloud vector database, or a separate server process you have to run |
| **Account / sign-up required?** | No — never | Sometimes |
| **Which AI tools does it work with?** | Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and any other MCP-compatible host | Usually just one specific tool (commonly Claude Code only) |
| **Secret redaction** | Built in and on by default — API keys, tokens, passwords, private keys, etc. are scrubbed before anything is saved | Often not handled, or left to the user |
| **Token budget control** | Injected memories are trimmed to a small, fixed token budget so they don't bloat every conversation (see benchmarks below) | Varies, often unbounded |
| **Old/stale memory cleanup** | Built-in retention policy automatically prunes old memories (configurable, on by default) | Often grows forever ("memory rot") |
| **Team sharing** | Optional, via a shared folder you already control (network drive, synced directory) — no server to host | Usually requires a shared hosted backend |
| **Offline-capable** | Yes, fully — works with no network connection by default | Usually requires network access to the memory service |

In short: `sessionmem` aims to be the **boring, local, "just a SQLite file" option** — easy to inspect, easy to back up, easy to delete, and not tied to any one vendor's AI tool.

---

## Benchmark results

These numbers come from `npm run benchmark` (`scripts/benchmark.mjs`), which runs the **real** production retrieval and injection code over a fixed, synthetic set of test data — no network calls, fully reproducible. See [`docs/benchmark.md`](docs/benchmark.md) for the full report and how to regenerate it.

### Token savings

> **~85.6% reduction** in tokens compared to carrying full session history.

| | Tokens |
|---|---|
| Full session history (baseline) | 1,587 |
| What sessionmem injects at the start of your next session | 228 |

In practice: instead of re-reading (or re-explaining) ~1,600 tokens of past context every session, the assistant gets a ~230-token summary of just the things that matter — decisions, warnings, and key facts.

### Retrieval accuracy

> **100% hit-rate** — every one of the 10 test queries successfully retrieved the memory it was supposed to.

| Metric | Result |
|---|---|
| Hit-rate (10 curated queries) | 100.0% |
| Recall | 100.0% |
| Precision | 33.3% |

Precision of 33.3% is expected here: each query retrieves the top 3 candidate memories, and only one of those three is the "expected" match for a given test query — the other two are still relevant context for the agent, just not the one being scored. The important number is recall/hit-rate: **the right memory is never missed.**

These benchmarks are deterministic and reproducible — run them yourself:

```bash
npm run build      # benchmark imports the compiled code from dist/
npm run benchmark  # regenerates docs/benchmark.md
```

---

## Quickstart

No programming experience needed for these steps — just a terminal (Command Prompt, Terminal, or PowerShell) and [Node.js](https://nodejs.org) installed.

### 1. Install sessionmem

```bash
npm install -g sessionmem
```

### 2. Register it with your AI tool

Run this inside the project folder you're working on, with your AI tool (Claude Code, Cursor, etc.) configured:

```bash
sessionmem install
```

This does two things:
- Tells your AI tool's MCP host about `sessionmem` so it can be launched automatically.
- Creates a config file at `~/.sessionmem/config.json` with safe, privacy-respecting defaults — **only if one doesn't already exist.**

### 3. Start using your AI tool as normal

```bash
sessionmem run
```

(Most of the time you won't run this yourself — your AI tool's host starts it for you automatically once it's registered.)

That's it. From here:
- `sessionmem` watches your sessions in the background.
- At the end of each session, it writes down a short summary of what mattered.
- At the start of your next session, it quietly reminds your assistant of the relevant bits.

You can verify everything is working with:

```bash
sessionmem ping
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

- **Adapters** are small pieces that know how to talk to each specific AI tool. This is why sessionmem can support many tools — adding a new one doesn't change how memory itself works.
- **The core engine** is the same no matter which tool you use. It decides what's worth remembering, how relevant it is later, and how much of it fits in a small "reminder" at the start of your next session.
- **The database** is just a file. You can back it up, move it, inspect it, or delete it like any other file on your computer.

For a deeper technical dive, see [`docs/architecture.md`](docs/architecture.md).

---

## CLI command reference

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

---

## Privacy, secrets, and your data

**Everything stays on your machine by default.** No account, no telemetry, no hosted memory service. Storage, retrieval, and summarization all run locally, governed by `~/.sessionmem/config.json`.

### Secrets are scrubbed automatically

Before anything is saved, `sessionmem` automatically removes common secret patterns and replaces them with `REDACTED`:

- Email addresses
- API keys (`sk-...`, AWS `AKIA...`, GitHub `ghp_...`/`gho_...`, etc.)
- Bearer tokens and JWTs
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Connection-string style secrets (`password=...`, `secret=...`)

This is **on by default**. You can scan and clean up older memories at any time:

```bash
sessionmem redact-scan          # see what would be redacted
sessionmem redact-scan --apply  # actually redact in place
```

Full details: [`docs/privacy-and-retention.md`](docs/privacy-and-retention.md).

---

## Memory rot: keeping memory accurate over time

"Memory rot" is what happens when a memory system keeps accumulating notes forever — eventually it's full of outdated decisions, duplicate facts, and noise, and the assistant starts surfacing **wrong or stale** information instead of helpful information.

`sessionmem` is designed to avoid this in a few ways:

1. **Retention pruning** — memories older than a configurable window (default **90 days**) are automatically eligible for cleanup. This runs as a light check at the end of every session, and can also be run manually:

   ```bash
   sessionmem retention prune          # dry run — shows what *would* be deleted
   sessionmem retention prune --force  # actually deletes
   ```

2. **Importance-weighted ranking** — when memories are retrieved, they're ranked by a blend of *semantic relevance*, *recency*, and *importance*. Old, low-importance notes naturally sink to the bottom and stop being surfaced even before they're pruned.

3. **Token-budgeted injection** — only the top-ranked, most relevant memories are injected (trimmed to a small token budget, see [benchmarks](#benchmark-results)), so even a large memory store doesn't translate into bloated, noisy context.

4. **Conflict resolution in team mode** — when memories are merged from teammates, the system uses last-write-wins by id (so stale duplicates don't pile up) while preserving the higher importance score (so a critical warning doesn't get silently downgraded).

The retrieval benchmark above (100% hit-rate / 100% recall) demonstrates that even with the ranking and trimming in place, the *right* memory still surfaces — accuracy isn't traded away for compactness.

You're always in control: export everything first if you want a permanent record before pruning:

```bash
sessionmem export
```

---

## Team mode (optional)

Want your whole team's AI assistants to share decisions and warnings? Point `sessionmem` at a shared folder (a network drive, a synced directory — anything everyone can read and write):

```bash
sessionmem team enable <shared-path>
sessionmem sync
```

- **Off by default** — nothing is shared until you turn it on.
- No server to host — it's just files in a folder you already control.
- Teammates' memories show up with an `author:` prefix so you know where they came from.
- Secrets are re-redacted on every pulled memory, so a teammate's snapshot can't reintroduce something your redaction policy would have stripped.

Full details, including the trust model: [`docs/team-mode.md`](docs/team-mode.md).

---

## Cloud summarization (optional, off by default)

By default, summarization (turning a session into a short memory) happens **entirely locally** — no API calls.

If you explicitly opt in (`allowCloudSummarization=true`) **and** provide an `ANTHROPIC_API_KEY`, summarization can use Claude's API for higher-quality summaries. If that ever fails, it automatically falls back to local summarization — your sessions are never left unsummarized.

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

...and any other tool that implements the [Model Context Protocol](https://modelcontextprotocol.io).

---

## Further documentation

- [Architecture](docs/architecture.md) — how the core engine, adapters, CLI, and SQLite storage fit together.
- [Benchmark](docs/benchmark.md) — full token-reduction and retrieval-accuracy report, and how to reproduce it.
- [Privacy and retention](docs/privacy-and-retention.md) — secret redaction, retention pruning, and config.
- [Team mode](docs/team-mode.md) — shared-path team memory.
- [Cloud summarization](docs/cloud-summarization.md) — the opt-in cloud summarization path.
- [Migration](docs/migration.md) — the SQLite migration system and version-upgrade policy.
- [Troubleshooting](docs/troubleshooting.md) — install failures, adapter issues, and `better-sqlite3` native-build problems.

---

## Troubleshooting

Run into trouble installing or running `sessionmem`? Start with [`docs/troubleshooting.md`](docs/troubleshooting.md) — it covers install failures, adapter-specific issues, and native module (`better-sqlite3`) build problems on different platforms.

Quick checks:

```bash
sessionmem ping     # is the server reachable?
sessionmem stats    # is data being stored?
```

---

## Contributing

Issues and pull requests are welcome. The codebase is TypeScript, tested with [Vitest](https://vitest.dev), and linted with ESLint:

```bash
npm install
npm run build
npm test
npm run lint
```

---

## License

[MIT](LICENSE)
