# Requirements: sessionmem

**Defined:** 2026-05-24
**Core Value:** Agent should remember right past decisions at right time, across sessions and platforms, without user re-explaining context.

## v1 Requirements

### Platform Integration

- [x] **PLAT-01**: User can install and run `sessionmem` on Claude Code.
- [x] **PLAT-02**: User can install and run `sessionmem` on Codex.
- [x] **PLAT-03**: User can install and run `sessionmem` on Cursor.
- [x] **PLAT-04**: User can install and run `sessionmem` on Cline.
- [x] **PLAT-05**: User can install and run `sessionmem` on Windsurf.
- [x] **PLAT-06**: User can install and run `sessionmem` on Antigravity.
- [x] **PLAT-07**: User can install and run `sessionmem` on QCoder.
- [x] **PLAT-08**: User can connect any other MCP-compatible host using documented generic adapter path.

### Session Capture

- [x] **CAPT-01**: User session events are captured locally with project and session IDs.
- [x] **CAPT-02**: User session end triggers summary generation with configurable local/cloud summarizer.
- [x] **CAPT-03**: User summary is embedded locally and stored durably in SQLite.
- [x] **CAPT-04**: User can disable auto-summarize and still store manual memories.

### Retrieval and Injection

- [x] **RETR-01**: User can retrieve semantically relevant memories for current task query.
- [x] **RETR-02**: User retrieval score combines semantic similarity, recency, and importance.
- [x] **RETR-03**: User startup memory injection is capped by configurable token budget.
- [x] **RETR-04**: User can request additional memories on demand beyond auto-injection.
- [x] **RETR-05**: User memory importance is boosted after successful retrieval (bounded).

### CLI and Lifecycle

- [x] **CLI-01**: User can run `sessionmem install` to configure required local components.
- [x] **CLI-02**: User can run `sessionmem uninstall` to remove config/hooks without deleting memory DB by default.
- [x] **CLI-03**: User can run `sessionmem search "<query>"` and get ranked results.
- [x] **CLI-04**: User can run `sessionmem list`, `show <id>`, and `forget` operations.
- [x] **CLI-05**: User can export all memories and import them back losslessly.
- [x] **CLI-06**: User can run `sessionmem stats` to see memory count, DB size, and token usage metrics.

### Team Mode

- [x] **TEAM-01**: Team can set shared-path sync and merge team memories into local retrieval.
- [x] **TEAM-02**: Team memories retain author attribution and timestamp provenance.
- [x] **TEAM-03**: Team can disable shared mode and return to local-only behavior without data loss.

### Security and Privacy

- [ ] **SECU-01**: User can set retention policy for automatic pruning of old memories.
- [ ] **SECU-02**: User can redact common secret patterns before summary persistence.
- [x] **SECU-03**: User can keep memory layer fully local (no external storage/retrieval dependency).
- [x] **SECU-04**: User is warned/documented when cloud summarization path is enabled.

### Quality and Launch

- [ ] **QLTY-01**: Maintainer has unit and integration tests covering core memory flows and adapters.
- [ ] **QLTY-02**: Maintainer has CI passing lint, typecheck, tests, and install smoke checks on major OSes.
- [ ] **QLTY-03**: User has docs for install, architecture, privacy/security, troubleshooting, and migration.
- [ ] **QLTY-04**: Maintainer publishes benchmark showing token reduction and retrieval relevance quality.
- [ ] **QLTY-05**: Maintainer publishes npm package and submits to target plugin/marketplace hubs.

## v2 Requirements

### Security

- **SECU-05**: User can encrypt memory at rest with user-managed key workflow.

### Sync

- **SYNC-01**: Team can optionally use hosted sync backend.

### Modalities

- **MULT-01**: User can store/retrieve non-text memory modalities.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Replacing project context artifacts entirely (e.g., `CLAUDE.md`) | sessionmem complements durable project docs, not full replacement |
| Model training/fine-tuning on memory corpus | retrieval architecture sufficient for v1 value |
| Mandatory cloud services for baseline memory functionality | violates local-first goal |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-01 | Phase 4 | Complete |
| PLAT-02 | Phase 4 | Complete |
| PLAT-03 | Phase 4 | Complete |
| PLAT-04 | Phase 4 | Complete |
| PLAT-05 | Phase 4 | Complete |
| PLAT-06 | Phase 4 | Complete |
| PLAT-07 | Phase 4 | Complete |
| PLAT-08 | Phase 4 | Complete |
| CAPT-01 | Phase 1 | Complete |
| CAPT-02 | Phase 2 | Complete |
| CAPT-03 | Phase 1 | Complete |
| CAPT-04 | Phase 2 | Complete |
| RETR-01 | Phase 1 | Complete |
| RETR-02 | Phase 1 | Complete |
| RETR-03 | Phase 3 | Complete |
| RETR-04 | Phase 3 | Complete |
| RETR-05 | Phase 3 | Complete |
| CLI-01 | Phase 5 | Complete |
| CLI-02 | Phase 5 | Complete |
| CLI-03 | Phase 5 | Complete |
| CLI-04 | Phase 5 | Complete |
| CLI-05 | Phase 5 | Complete |
| CLI-06 | Phase 5 | Complete |
| TEAM-01 | Phase 7 | Complete |
| TEAM-02 | Phase 7 | Complete |
| TEAM-03 | Phase 7 | Complete |
| SECU-01 | Phase 6 | Pending |
| SECU-02 | Phase 6 | Pending |
| SECU-03 | Phase 1 | Complete |
| SECU-04 | Phase 2 | Complete |
| QLTY-01 | Phase 8 | Pending |
| QLTY-02 | Phase 8 | Pending |
| QLTY-03 | Phase 8 | Pending |
| QLTY-04 | Phase 8 | Pending |
| QLTY-05 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-24*
*Last updated: 2026-05-24 after initial definition*
