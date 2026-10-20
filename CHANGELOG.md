# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
