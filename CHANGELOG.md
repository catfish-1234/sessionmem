# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `sessionmem redact-scan` also scrubs stored session events, the raw tool and
  transcript payloads summaries are built from. They were redacted when
  ingested, but only by the rules of the version that ingested them, so a
  format added later stayed on disk until retention pruned it. The scan counts
  matching events (their payloads are raw tool output, so they are not
  previewed), and `--apply` rewrites them, only ever to a payload that is still
  valid JSON. Run `sessionmem redact-scan --apply` after upgrading to apply
  this release's new formats to data you already have.

- Redaction knows more token formats that coding sessions print: Google OAuth
  access tokens (`ya29.`, what `gcloud auth print-access-token` writes to the
  terminal), refresh tokens and OAuth client secrets (`GOCSPX-`); Stripe
  test-mode secret and restricted keys and webhook signing secrets (`whsec_`);
  Groq, xAI, Replicate, Perplexity and Tavily API keys; Supabase access tokens
  and secret keys; and age secret keys. Each is anchored to its published
  prefix and length, so prose that only names a prefix is left alone.

### Fixed

- An armored OpenPGP private key was stored verbatim: its markers end in
  `KEY BLOCK` plus dashes, and the private-key rule required them to end in
  `PRIVATE KEY` plus dashes. It is now redacted like a PEM block.
- A private key cut off before its `-----END` line, such as a `head` of a key
  file or a tool result clipped at a size limit, kept its whole body, because
  the rule needed both markers. The armor headers and every base64 line after
  an unterminated `BEGIN ... PRIVATE KEY` marker are now redacted, in plain
  text and inside JSON-escaped event payloads, which stay parseable.
- `npm test` run from inside Claude Code failed 22 specs on a clean checkout.
  Every CLI a spec spawned inherited the session's `CLAUDECODE` and session id
  and behaved as the Claude Code host. A vitest setup file now clears the
  host-detection variables before each spec file; specs about host detection
  set their own.
- The Codex transcript spec read the real Cursor history on a Windows machine
  with Cursor installed, because Cursor keeps it under `%APPDATA%`, which the
  spec did not redirect along with `HOME` and `USERPROFILE`. It does now.

### Changed

- The optional local semantic model now pins `onnxruntime-node` 1.31.1 (was
  1.30.0), and the install command in docs/local-semantic.md says the same, so
  following the docs no longer installs a version the peer pin rejects.

## [2.1.0] - 2026-11-19

### Added

- `sessionmem remember <text>` stores a memory by hand for the current
  project: a decision, preference or warning you want every future session to
  know, without waiting for an agent to capture it. `--kind` (default `fact`),
  `--importance` (1-10, default 7, above a routine capture), repeatable
  `--tag`, `--expires` (`12h`, `30d`, `2w`, a date or a UTC timestamp; an
  impossible date such as February 31 is rejected rather than rolled over),
  `--scope`, and `--json`. `-` reads the text from stdin. It uses the same
  write path as the MCP tools, so secrets (including your own
  `redactionPatterns`) are redacted before anything is saved, and the command
  says when that happened and prints the `forget` command that undoes it.

- `sessionmem search`, `list` and `show` take `--json`, for scripts: matches
  with their query, the listed memories with the project total, or the one
  memory. The table output stays the default.

### Fixed

- A slow or unreachable Anthropic API could cost a session its summary when
  cloud summarization is on. The request had the SDK's 10-minute timeout and
  its own retries inside sessionmem's, so the SessionEnd hook could be stopped
  by the host before the local fallback ran. A request now gives up after 25
  seconds, retries happen only while they fit in a 45-second budget and only
  for errors another attempt could fix (not a bad request, an auth failure or a
  refusal), and the local summary is stored when the budget runs out.

### Changed

- Update `@anthropic-ai/sdk` to 1.11.0.
- Releasing is one command: `npm run release` checks that `main` is clean, pushed and green, then
  tags the version and pushes it. `--backfill` also tags older versions that never got a tag,
  oldest first, and holds the current version until their runs finish; `--dry-run` shows the plan.
  See CONTRIBUTING.md.
- The release workflow keeps npm's `latest` dist-tag and GitHub's latest release on the newest
  version: an older tag publishes under `legacy` and a prerelease under `next`.

## [2.0.0] - 2026-11-19

### Removed

- Node 20, which reached end of life on 2026-04-30, is no longer supported.
  sessionmem now needs Node 22.13 or newer (`engines.node` is `>=22.13.0`),
  CI tests Node 22, 24 and 26, and the Docker image runs on Node 24.

### Changed

- The cloud summarizer now defaults to Claude Sonnet 5.5 (`claude-sonnet-5-5`),
  run at low effort: compressing a summary is a short, well-defined task.
  Its response budget leaves room for the model's thinking, and is capped
  at 16,000 tokens.
- A request the summarizer model declines is retried on a fallback model by
  the API (`fallbacks: "default"`), and if it is still declined sessionmem
  keeps the local summary instead of storing a refusal as memory. A
  `summarizerModel` you set yourself is sent as before, without an effort
  setting or server-side fallback, since older models reject effort and
  some current ones (Claude Haiku 5.5) reject fallbacks.
- Update `@anthropic-ai/sdk` to 1.10.0, better-sqlite3 to 13 (SQLite
  3.54.1), and Commander to 15. Tests run on Vitest 5.

## [1.12.0] - 2026-11-18

### Added

- `redactionPatterns` in `~/.sessionmem/config.json` redacts your organisation's
  own secret formats (an internal API key, a session cookie shape) on every
  write and in `redact-scan`, each as `[REDACTED_<NAME>]`, ahead of the
  built-in rules. A pattern that is not a valid regular expression, matches
  the empty string, is over 500 characters, or nests a repeat inside a repeat
  (which can backtrack for minutes) is skipped on its own and named by
  `sessionmem doctor`. See [privacy docs](docs/privacy-and-retention.md#your-own-secret-formats).

### Changed

- Update semgrep to 1.184.0 in the security workflow.

## [1.11.0] - 2026-11-17

### Added

- `sessionmem export --format markdown` writes a readable project memory:
  grouped by kind (warnings, decisions, facts, preferences, summaries), most
  important first, with author, date, scope, tags and id on each entry.
  `--min-importance <n>` and `--include-expired` filter it; expired memories
  are left out by default because they are no longer recalled. The format is
  inferred from a `.md` path, and `-` writes either format to stdout. Memory
  content is rendered inert (HTML escaped, control and bidi characters
  removed, fence and heading markers escaped), so one memory cannot
  restructure or hide the rest of the document. JSON stays the lossless,
  re-importable format.

### Fixed

- Redact Anthropic API and admin keys, OpenAI project, service-account and
  admin keys, and Hugging Face, GitLab, SendGrid, PyPI, Docker Hub,
  DigitalOcean, Shopify, Linear, Twilio and Databricks tokens, plus Azure
  connection-string keys. Anthropic and OpenAI project keys carry `_` and `-`
  in their body, where the generic `sk-` rule stopped, so they were stored in
  full or with a readable tail; the others had no rule. Run
  `sessionmem redact-scan` to check memories stored before this release, and
  `sessionmem redact-scan --apply` to scrub them.
- The startup injection now strips every character that can start a new line
  or reorder visible text: vertical tab, form feed, NEL, the Unicode line and
  paragraph separators, and bidi embedding, override and isolate controls,
  which it previously kept. A synced teammate memory could use them to start
  what reads as a new line inside the context block an agent treats as
  instructions.

### Security

- Update `hono` and `@hono/node-server`, which reach the runtime tree through
  the MCP SDK, and `minimatch` in the lint toolchain, past their published
  advisories. `npm audit` reports none.

## [1.10.2] - 2026-11-07

### Fixed

- Redact prose secret declarations before saving. Redaction previously matched
  only `key=value` and `key: value` assignments, so a credential stated in a
  sentence ("the database password is hunter2") was stored verbatim and could
  be injected back into model context as prior context. A conservative rule now
  covers `<secret key> is <value>`: quoted values always, bare values only when
  credential-shaped (a letter plus a digit or symbol), with a stoplist that
  keeps judgement prose ("password is required", "token is expired")
  byte-identical. `redact-scan` picks the same coverage up for existing
  memories ([#69]).

### Changed

- README and privacy docs now describe redaction as best-effort pattern
  coverage rather than promising that passwords are always scrubbed, and
  advise against stating real credentials in agent chats ([#69]).

## [1.10.1] - 2026-10-30

### Fixed

- Restore the committed `package-lock.json` with body-parser 2.4.0, patching
  CVE-2026-111181. Rename the benchmark requirement files to `*-freeze.txt` so
  Dependabot no longer treats them as live Python requirements; security
  updates apply cleanly again ([#63]).

### Changed

- Bump fast-uri from 3.1.8 to 3.1.9 ([#64]) and eslint from 10.12.0 to
  10.13.0 ([#61]).

## [1.10.0] - 2026-10-23

### Added

- Optional scopes for sessions, memories and extracted entity associations.
  Capture detects a directory or project label and accepts explicit overrides.
  Retrieval supports exact scope filters and bounded scope boosts, including
  compact search, scoped timelines and detail lookups. Default retrieval remains
  all scopes with byte-identical responses. Includes CLI, local API and typed
  client support, a non-destructive versioned migration, a committed old-format
  SQLite fixture and byte-preservation tests for failed upgrades. LoCoMo hit rate
  @5 stays 64.4401% with zero changed rankings. No new runtime dependencies or
  network calls. See [scopes](docs/scopes.md) and [eval results](benchmarks/scopes.md).
- Optional bounded entity boost for retrieval and compact index search. Enable
  with `sessionmem config set entityBoost true`. Case-insensitive exact names
  and existing explicit aliases add up to 0.06 to the final score alongside
  lexical relevance, time-aware ranking and importance. No new dependencies or
  network calls. Defaults off: LoCoMo hit rate @5 improves from 64.44% to 64.51%,
  but precision and recall regress. Includes entity, alias, unchanged-query,
  recency, visibility and compact-flow tests. See [eval results](benchmarks/entity-boost.md).

## [1.9.0] - 2026-10-20

### Added

- A local single-user REST API with compact search, timelines, memory details,
  saving and deletion. Start it with `sessionmem serve --api`. It defaults to
  loopback, rejects cross-origin requests, and supports optional bearer tokens.
- A small fetch-based JavaScript client with TypeScript types, available from
  `sessionmem/client`. Retrieval and existing project filtering are unchanged.
  ([#58])

## [1.8.0] - 2026-10-19

### Added

- Claude Code prompt-time recall, startup transcript catch-up, MCP flow
  instructions, and fresh-install capture-to-new-session CI coverage for Claude
  Code, Codex and Cursor. Doctor reports capture and recall modes separately,
  validates agent guidance, and provides repair hints. Install detects additional
  host CLIs, fails on missing guidance, and installs Cursor rules in the project.
  Cline preapproves local lookup and capture tools for the instructed flow.
- Independent adaptive BM25, damped entity and normalized additive fusion
  hypotheses based on the requested Mem0 source audit. All attempted variants
  and their regressions are retained in the retrieval evaluation.
- Compact MCP retrieval through `searchMemoryIndex`, `memoryTimeline`, and the
  existing full-detail `getMemory`. New tools use bounded previews and limits,
  preserve project and expiry filtering, and leave access counters unchanged.
  Includes service and stdio tests and measured LoCoMo response-token costs.
- Optional deterministic temporal retrieval using supersession and observation
  timestamps for current and past queries. Uncued queries retain existing
  behavior. Tests cover date boundaries, history overrides and semantic visibility.
  Defaults off because pinned-clock LoCoMo quality did not improve.
- Optional entity-link candidates and weighted fusion with BM25 and local
  semantic scores. Includes alias, isolation and fusion tests. Coverage defaults
  on for BM25
  (64.44% hit, 14.32% precision, 58.27% recall) and off with active MiniLM
  because hybrid hit rate and recall regressed. Explicit overrides remain available.
- Repeatable ranking ablations, a three-metric regression gate, complete lost-hit
  and lost-evidence accounting, public README references and before/after tables.
  Default BM25 improves all three primary metrics; optional hybrid quality is
  unchanged. See
  [retrieval results](benchmarks/retrieval-gaps.md) and
  [tool and ranking guide](docs/retrieval-tools.md).

### Fixed

- Prompt-time recall now resolves symlinks before deriving the project id, so
  hook payload paths and the working directory map to the same memory (this
  affected macOS temp and symlinked directories). ([#57])

## [1.7.0] - 2026-10-18

### Added

- Automatic transcript capture at login: per-user login services on macOS,
  Linux, and Windows keep `sessionmem watch` running after install, so new
  sessions are captured without a manual command. ([#54])
- Optional local MiniLM retrieval complements FTS5 with learned semantic
  candidates. Installed model files are verified locally; unavailable inference
  falls back to BM25. The feature defaults off. See [setup](docs/local-semantic.md).
  ([#55])
- Pinned competitor source reviews, local raw-turn LoCoMo comparisons, complete
  result archives, and per-question retrieval regressions. Measured on LoCoMo:
  hit rate 63.92% to 66.47%, precision 14.05% to 14.77%, recall 57.45% to
  59.76%. See [measured comparison](COMPARISON.md). ([#55])

## [1.6.0] - 2026-10-18

### Added

- Multi-host transcript imports: `sessionmem scan` and `sessionmem watch` now
  sweep Claude Code, Codex CLI, and Cursor histories by default, with a
  separate parser per host and an explicit unsupported-format error when a
  claimed host's records cannot be parsed. `--host` selects one host.
  ([#52], [#53])
- Codex CLI support: dated rollout discovery, project and session identity from
  session metadata, resume-file grouping with cross-file deduplication,
  sub-agent session separation, native tool-call events, and filtering of
  encrypted agent payloads and injected machine blocks. ([#52])
- Cursor support: chat history read from Cursor's SQLite storage through
  private snapshot copies opened read-only, covering both composer index
  layouts, with per-composer checkpoints and live-update handling. ([#53])
- `sessionmem doctor` now checks transcript discovery for each supported
  host. ([#52], [#53])

## [1.5.0] - 2026-10-18

### Added

- `sessionmem scan` to import existing Claude Code transcripts into memory, and
  `sessionmem watch` to capture new and updated sessions continuously. Both are
  idempotent across reruns and restarts and work fully offline. ([#45])
- Automatic host detection during `sessionmem install`, and a `sessionmem doctor`
  command that checks the store, hooks, adapter wiring, and recall with fix
  hints for each failure. ([#46])
- Deterministic entity and relation extraction during capture and scan, a
  `sessionmem entities` command, and entity overlap as a recall ranking
  signal. ([#48])
- Deterministic supersession handling: memories that replace an earlier fact are
  linked with history, and recall prefers current facts while replaced ones stay
  retrievable explicitly. ([#49])
- `sessionmem ui`, a local read-only web viewer for memories, entities,
  relations, and supersession history, served on localhost with no external
  services. ([#50])
- COMPARISON.md, a cited comparison with claude-mem, Mem0, and Zep, plus a draft
  MCP registry listing. ([#51])
- A reproducible offline LoCoMo evaluation: committed corpus with provenance and
  checksums, and a runner reporting hit rate, precision, recall, and latency
  with all network access blocked. ([#44])

### Changed

- Retrieval now ranks with SQLite FTS5 BM25 and Porter stemming over memory
  content and summaries. Measured on the committed LoCoMo evaluation, top-5 hit
  rate improved from 1.44% to 61.95%, and to 63.92% with entity overlap. ([#47], [#48])
- The release workflow skips the npm publish when the version already exists on
  the registry and creates the GitHub release with notes from this
  changelog. ([#43])

## [1.4.0] - 2026-10-16

### Added

- A `SECURITY.md` policy covering supported releases, private vulnerability
  reporting through GitHub security advisories, and response expectations. ([#31])
- Bug report and pull request templates, with private security reporting guidance. ([#40])
- Documentation of the TypeScript 7 toolchain blocker and criteria for revisiting
  the upgrade. ([#33])
- Package homepage and issue tracker metadata, and bundled documentation,
  changelog, contribution and security policies, and the README logo in the npm
  package. ([#34], [#40])

### Changed

- Aligned supported Node.js versions to `^20.19.0 || >=22.13.0`, using Commander
  14.0.3 to retain Node 20 compatibility. Deferred better-sqlite3 13 and Vitest 5,
  and temporarily ignored TypeScript 7+ updates until the toolchain supports them. ([#33], [#34])
- Updated compatible runtime and development dependencies, including the Anthropic
  and MCP SDKs, better-sqlite3, Zod, ESLint, typescript-eslint, globals, and SQLite
  types; upgraded the setup-node action. ([#22], [#23], [#24], [#28], [#34])
- Clarified installation, adapter selection, Claude Code lifecycle hooks versus
  other MCP hosts, local database checks, command limits, import behavior,
  environment overrides, cloud fallback, and migration guidance in the README,
  CLI help, and linked documentation. The development MCP template now runs the
  local build, and the `llms.txt` example includes the required `run` argument. ([#34], [#40])

### Fixed

- Database path overrides now create only the selected database's parent
  directories, without creating `~/.sessionmem`. Server logs stay beside that
  database, and in-memory databases do not create log directories. ([#40])
- Null and other invalid import records are skipped with warnings instead of
  crashing; imports preserve provenance and original record indices. UTF-8 BOM
  and CRLF files are accepted, and invalid UTF-8 is rejected. Null or non-object
  policy configuration safely falls back to defaults. ([#40])
- Token caps now account for truncation markers and enforce actual token counts,
  including large-session summaries and cloud summarization output. ([#40])
- Concurrent SQLite WAL initialization retries within a bounded five-second wait;
  migration checks and writes are serialized, and failed database initialization
  closes its handle. ([#40])
- Malformed numeric search limits and deduplication thresholds are rejected.
  Search consistently defaults to 10 results, and memory lists warn when the
  200-record limit truncates their output. ([#40])
- CLI install, uninstall, and default-export tests use temporary home directories;
  project-root fixtures no longer depend on whether the temporary directory is
  inside another repository. ([#30])
- The mirrored package manifest and Docker install pin stay synchronized with
  release versions and runtime dependency metadata. ([#34])
- The release workflow installs dependencies, builds, and tests before upgrading
  npm for trusted publishing, preserving better-sqlite3's native install step.
  ([62765a7])

### Security

- Refreshed vulnerable transitive dependencies, including `proxy-addr` 2.0.8 and
  `fast-uri` 3.1.8, with MCP SDK 1.32.1, removing the reported critical and moderate
  advisories without suppressing findings. ([#27], [#29])
- Pinned every GitHub Action in CI, release, and security workflows to a verified
  full commit SHA. Replaced the retired Semgrep action with CLI 1.181.0 so scanner
  errors and findings fail the job; added scanner dependency updates and
  Dependabot cooldowns. ([#32])

[1.10.2]: https://github.com/catfish-1234/sessionmem/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/catfish-1234/sessionmem/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/catfish-1234/sessionmem/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/catfish-1234/sessionmem/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/catfish-1234/sessionmem/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/catfish-1234/sessionmem/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/catfish-1234/sessionmem/compare/v1.5.0...v1.6.0
[#54]: https://github.com/catfish-1234/sessionmem/pull/54
[#55]: https://github.com/catfish-1234/sessionmem/pull/55
[1.5.0]: https://github.com/catfish-1234/sessionmem/compare/679b8954f0b49f197985c40da47f181c00060cd9...v1.5.0
[#43]: https://github.com/catfish-1234/sessionmem/pull/43
[#44]: https://github.com/catfish-1234/sessionmem/pull/44
[#45]: https://github.com/catfish-1234/sessionmem/pull/45
[#46]: https://github.com/catfish-1234/sessionmem/pull/46
[#47]: https://github.com/catfish-1234/sessionmem/pull/47
[#48]: https://github.com/catfish-1234/sessionmem/pull/48
[#49]: https://github.com/catfish-1234/sessionmem/pull/49
[#50]: https://github.com/catfish-1234/sessionmem/pull/50
[#51]: https://github.com/catfish-1234/sessionmem/pull/51
[#52]: https://github.com/catfish-1234/sessionmem/pull/52
[#53]: https://github.com/catfish-1234/sessionmem/pull/53
[1.4.0]: https://github.com/catfish-1234/sessionmem/compare/a73f503123b1d33c35407ce66403f281ba3451ac...679b8954f0b49f197985c40da47f181c00060cd9
[#22]: https://github.com/catfish-1234/sessionmem/pull/22
[#23]: https://github.com/catfish-1234/sessionmem/pull/23
[#24]: https://github.com/catfish-1234/sessionmem/pull/24
[#27]: https://github.com/catfish-1234/sessionmem/pull/27
[#28]: https://github.com/catfish-1234/sessionmem/pull/28
[#29]: https://github.com/catfish-1234/sessionmem/pull/29
[#30]: https://github.com/catfish-1234/sessionmem/pull/30
[#31]: https://github.com/catfish-1234/sessionmem/pull/31
[#32]: https://github.com/catfish-1234/sessionmem/pull/32
[#33]: https://github.com/catfish-1234/sessionmem/pull/33
[#34]: https://github.com/catfish-1234/sessionmem/pull/34
[#40]: https://github.com/catfish-1234/sessionmem/pull/40
[62765a7]: https://github.com/catfish-1234/sessionmem/commit/62765a7
[#57]: https://github.com/catfish-1234/sessionmem/pull/57
[#58]: https://github.com/catfish-1234/sessionmem/pull/58
[#61]: https://github.com/catfish-1234/sessionmem/pull/61
[#63]: https://github.com/catfish-1234/sessionmem/pull/63
[#64]: https://github.com/catfish-1234/sessionmem/pull/64
[#69]: https://github.com/catfish-1234/sessionmem/pull/69
