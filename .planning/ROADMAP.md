# Roadmap

**Project:** sessionmem  
**Created:** 2026-05-24  
**Granularity:** fine  
**Mode:** yolo

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Core Memory Engine Foundation | Build host-agnostic core storage, schema, embedding, retrieval primitives, and adapter contract baseline | CAPT-01, CAPT-03, RETR-01, RETR-02, SECU-03 | 5 |
| 2 | Session Lifecycle + Summarization Pipeline | Implement session event ingestion and end-of-session summarization pipeline with local/cloud strategy | CAPT-02, CAPT-04, SECU-04 | 4 |
| 3 | Injection Quality + Token Control | Implement startup injection formatter and ranking controls with bounded token budget and importance feedback | RETR-03, RETR-04, RETR-05 | 5 |
| 4 | Multi-Platform Adapter Rollout | Deliver parity adapters for tier-1 hosts and generic MCP host path | PLAT-01, PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-06, PLAT-07, PLAT-08 | 6 |
| 5 | CLI Lifecycle and Data Operations | 5/5 | Complete   | 2026-06-10 |
| 6 | Security, Privacy, and Retention Hardening | 5/7 | In Progress|  |
| 7 | Team Mode Shared Memory | Implement shared-path sync, provenance metadata, and safe local-only fallback | TEAM-01, TEAM-02, TEAM-03 | 5 |
| 8 | Launch Quality and Distribution | Deliver tests, CI, docs, benchmark, npm publish, and marketplace/plugin submissions | QLTY-01, QLTY-02, QLTY-03, QLTY-04, QLTY-05 | 6 |

## Phase Details

### Phase 1: Core Memory Engine Foundation

**Goal:** Build stable, host-agnostic memory core and data model that all adapters rely on.

**Requirements:** CAPT-01, CAPT-03, RETR-01, RETR-02, SECU-03

**Plan Progress:** 4 / 4 complete (`01-01`, `01-02`, `01-03`, `01-04` done)

**Success Criteria:**

1. SQLite schema for memories and session events exists with migrations and indexes.
2. Local embedding module generates deterministic embeddings from text inputs.
3. Retrieval service returns ranked memories using semantic + recency + importance weighting.
4. Core APIs are host-agnostic and callable from adapter contracts.
5. Local-only operation works without external storage dependency.

### Phase 2: Session Lifecycle + Summarization Pipeline

**Goal:** Capture sessions and turn them into durable memory entries automatically.

**Requirements:** CAPT-02, CAPT-04, SECU-04

**Plans:** 3/3 plans complete (completed 2026-05-26)

Plans:

- [x] 02-01-PLAN.md - Define lifecycle contracts, failure persistence, and Wave 0 tests
- [x] 02-02-PLAN.md - Implement session-end orchestration with local/cloud retry-fallback flow
- [x] 02-03-PLAN.md - Add cloud-warning visibility, opt-in verification, and security docs

**Success Criteria:**

1. Session end pipeline summarizes event stream into bounded summary format.
2. Summarization mode supports cloud model path and local fallback path.
3. Auto-summarize can be disabled while manual memory storage remains available.
4. User-visible config/docs clearly indicate when cloud summarization is enabled.

### Phase 3: Injection Quality + Token Control

**Goal:** Ensure injected memories are relevant, compact, and reliable.

**Requirements:** RETR-03, RETR-04, RETR-05

**Plan Progress:** 3 / 3 complete (`03-01`, `03-02`, `03-03` done, completed 2026-06-04)

**Success Criteria:**

1. Startup injection formatter enforces configurable token cap.
2. Retrieval pipeline supports on-demand deeper fetch beyond default auto-injection.
3. Importance boost updates memory relevance score safely with upper bound.
4. Injection output is deterministic for identical ranking inputs.
5. Quality harness verifies relevance and token-budget compliance.

### Phase 4: Multi-Platform Adapter Rollout

**Goal:** Deliver v1 platform coverage for major coding hosts plus generic MCP support.

**Requirements:** PLAT-01, PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-06, PLAT-07, PLAT-08

**Plans:** 5/5 plans complete (verified 2026-06-08)

Plans:

- [x] 04-01-PLAN.md - Core adapter factory and auto-detect logic
- [x] 04-02-PLAN.md - Claude Code, Codex, Antigravity, QCoder, and Generic MCP adapters
- [x] 04-03-PLAN.md - Cursor, Cline, and Windsurf adapters with IDEInstaller
- [x] 04-04-PLAN.md - Missing capability fallbacks (fetch_memories, startup_inject_memories)
- [x] 04-05-PLAN.md - Manual config fallback, run command, ping tool

**Success Criteria:**

1. Claude Code adapter install/run path verified end-to-end. ✓
2. Codex adapter install/run path verified end-to-end. ✓
3. Cursor/Cline/Windsurf adapters verified with host-specific config workflows. ✓
4. Antigravity and QCoder adapters implemented with documented setup and caveats. ✓
5. Generic MCP adapter path documented and tested for additional hosts. ✓
6. Adapter parity test matrix passes for core memory behaviors. ✓

### Phase 5: CLI Lifecycle and Data Operations

**Goal:** Provide complete operational CLI surface and reliable install lifecycle.

**Requirements:** CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Build/bin pipeline, shared CLI context, output formatters, commander shell, Wave 0 tests

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Install lifecycle (D-04/D-05), run refactor, uninstall (--purge), ping
- [x] 05-03-PLAN.md — search, list, show, stats commands (CLI-03/04/06)
- [x] 05-04-PLAN.md — forget (dry-run), export, import (skip/--merge) (CLI-04/05)

**Wave 3** *(gap closure — blocked on 05-01/05-03/05-04)*

- [x] 05-05-PLAN.md — Fix commander .action ctx-collision + --limit coercion; add spawning end-to-end regression spec (CLI-03/04/05/06)

**Success Criteria:**

1. `install` configures required local components and validates health.
2. `uninstall` removes integration artifacts but preserves DB unless explicit purge.
3. `search`, `list`, `show`, and `forget` commands operate correctly on stored memories.
4. `export` and `import` preserve data fidelity and metadata.
5. `stats` reports memory count, DB size, and token metrics.
6. CLI command UX includes actionable errors and non-zero exit codes on failure.

### Phase 6: Security, Privacy, and Retention Hardening

**Goal:** Make privacy controls and secret protections production-ready.

**Requirements:** SECU-01, SECU-02

**Plans:** 5/7 plans executed

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Expand redaction rule set (D-05) + policyConfig.json read/write/resolve module (D-09/D-11)
- [x] 06-02-PLAN.md — Retention prune core: count/delete-older-than repo + pruneMemories contract/service (SECU-01)

**Wave 2** *(blocked on Wave 1)*

- [x] 06-03-PLAN.md — Redaction on all write paths (store/import) + redactExisting scrub op (SECU-02, D-06/D-07/D-08)
- [x] 06-04-PLAN.md — Session-end light auto-prune wiring (D-02), non-blocking

**Wave 3** *(blocked on 06-01/06-02)*

- [x] 06-05-PLAN.md — CLI retention prune (--force) + config get/set + install config.json defaults (D-10/D-12/D-13)

**Wave 4** *(blocked on 06-03/06-05)*

- [ ] 06-06-PLAN.md — CLI redact-scan (--apply) + stats retention/redaction lines + secret-leakage test suite (D-14/D-15)
- [ ] 06-07-PLAN.md — Privacy/retention user documentation + doc-coverage test (success criterion 4)

**Success Criteria:**

1. Retention policy prunes old memories by configurable age.
2. Secret redaction pass runs before summary persistence.
3. Security tests cover common secret-pattern leakage scenarios.
4. Redaction behavior and retention policy are documented for users.
5. Policy controls integrate with core and adapter flows consistently.

### Phase 7: Team Mode Shared Memory

**Goal:** Enable safe shared-memory workflow for teams without hosted backend.

**Requirements:** TEAM-01, TEAM-02, TEAM-03

**Success Criteria:**

1. Shared-path sync reads/writes team memory artifacts reliably.
2. Team memories include author and timestamp provenance metadata.
3. Merge behavior handles duplicates/conflicts predictably.
4. Users can disable team mode and continue local-only workflow without data loss.
5. Team mode behavior is documented with setup and failure-recovery guidance.

### Phase 8: Launch Quality and Distribution

**Goal:** Reach launch-ready v1 standard and publish broadly.

**Requirements:** QLTY-01, QLTY-02, QLTY-03, QLTY-04, QLTY-05

**Success Criteria:**

1. Unit and integration test coverage includes core flows and adapters.
2. CI pipeline passes lint, typecheck, tests, and install smoke checks on major OSes.
3. Docs set includes install, architecture, privacy/security, troubleshooting, migration.
4. Benchmark report demonstrates token reduction and retrieval relevance quality.
5. npm package published with reproducible build/release process.
6. Plugin/marketplace submission artifacts completed for target hubs.

## Coverage Validation

- v1 requirements total: 35
- Mapped requirements: 35
- Unmapped requirements: 0 ?

## Notes

- Roadmap intentionally fine-grained to match selected `granularity: fine`.
- Cross-platform parity and launch artifacts are explicit first-class phases, not optional tail work.

---
*Roadmap created: 2026-05-24*
