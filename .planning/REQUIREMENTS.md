# Requirements: sessionmem

**Defined:** 2026-05-24
**Core Value:** Agent should remember right past decisions at right time, across sessions and platforms, without user re-explaining context.

## v1 Requirements

### Platform Integration

- [ ] **PLAT-01**: User can install and run `sessionmem` on Claude Code.
- [ ] **PLAT-02**: User can install and run `sessionmem` on Codex.
- [ ] **PLAT-03**: User can install and run `sessionmem` on Cursor.
- [ ] **PLAT-04**: User can install and run `sessionmem` on Cline.
- [ ] **PLAT-05**: User can install and run `sessionmem` on Windsurf.
- [ ] **PLAT-06**: User can install and run `sessionmem` on Antigravity.
- [ ] **PLAT-07**: User can install and run `sessionmem` on QCoder.
- [ ] **PLAT-08**: User can connect any other MCP-compatible host using documented generic adapter path.

### Session Capture

- [ ] **CAPT-01**: User session events are captured locally with project and session IDs.
- [ ] **CAPT-02**: User session end triggers summary generation with configurable local/cloud summarizer.
- [ ] **CAPT-03**: User summary is embedded locally and stored durably in SQLite.
- [ ] **CAPT-04**: User can disable auto-summarize and still store manual memories.

### Retrieval and Injection

- [ ] **RETR-01**: User can retrieve semantically relevant memories for current task query.
- [ ] **RETR-02**: User retrieval score combines semantic similarity, recency, and importance.
- [ ] **RETR-03**: User startup memory injection is capped by configurable token budget.
- [ ] **RETR-04**: User can request additional memories on demand beyond auto-injection.
- [ ] **RETR-05**: User memory importance is boosted after successful retrieval (bounded).

### CLI and Lifecycle

- [ ] **CLI-01**: User can run `sessionmem install` to configure required local components.
- [ ] **CLI-02**: User can run `sessionmem uninstall` to remove config/hooks without deleting memory DB by default.
- [ ] **CLI-03**: User can run `sessionmem search "<query>"` and get ranked results.
- [ ] **CLI-04**: User can run `sessionmem list`, `show <id>`, and `forget` operations.
- [ ] **CLI-05**: User can export all memories and import them back losslessly.
- [ ] **CLI-06**: User can run `sessionmem stats` to see memory count, DB size, and token usage metrics.

### Team Mode

- [ ] **TEAM-01**: Team can set shared-path sync and merge team memories into local retrieval.
- [ ] **TEAM-02**: Team memories retain author attribution and timestamp provenance.
- [ ] **TEAM-03**: Team can disable shared mode and return to local-only behavior without data loss.

### Security and Privacy

- [ ] **SECU-01**: User can set retention policy for automatic pruning of old memories.
- [ ] **SECU-02**: User can redact common secret patterns before summary persistence.
- [ ] **SECU-03**: User can keep memory layer fully local (no external storage/retrieval dependency).
- [ ] **SECU-04**: User is warned/documented when cloud summarization path is enabled.

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
| PLAT-01 | Unmapped | Pending |
| PLAT-02 | Unmapped | Pending |
| PLAT-03 | Unmapped | Pending |
| PLAT-04 | Unmapped | Pending |
| PLAT-05 | Unmapped | Pending |
| PLAT-06 | Unmapped | Pending |
| PLAT-07 | Unmapped | Pending |
| PLAT-08 | Unmapped | Pending |
| CAPT-01 | Unmapped | Pending |
| CAPT-02 | Unmapped | Pending |
| CAPT-03 | Unmapped | Pending |
| CAPT-04 | Unmapped | Pending |
| RETR-01 | Unmapped | Pending |
| RETR-02 | Unmapped | Pending |
| RETR-03 | Unmapped | Pending |
| RETR-04 | Unmapped | Pending |
| RETR-05 | Unmapped | Pending |
| CLI-01 | Unmapped | Pending |
| CLI-02 | Unmapped | Pending |
| CLI-03 | Unmapped | Pending |
| CLI-04 | Unmapped | Pending |
| CLI-05 | Unmapped | Pending |
| CLI-06 | Unmapped | Pending |
| TEAM-01 | Unmapped | Pending |
| TEAM-02 | Unmapped | Pending |
| TEAM-03 | Unmapped | Pending |
| SECU-01 | Unmapped | Pending |
| SECU-02 | Unmapped | Pending |
| SECU-03 | Unmapped | Pending |
| SECU-04 | Unmapped | Pending |
| QLTY-01 | Unmapped | Pending |
| QLTY-02 | Unmapped | Pending |
| QLTY-03 | Unmapped | Pending |
| QLTY-04 | Unmapped | Pending |
| QLTY-05 | Unmapped | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 0
- Unmapped: 35 ?

---
*Requirements defined: 2026-05-24*
*Last updated: 2026-05-24 after initial definition*
