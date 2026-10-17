# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
