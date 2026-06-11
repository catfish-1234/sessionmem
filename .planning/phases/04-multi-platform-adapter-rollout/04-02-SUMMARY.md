---
phase: 04-multi-platform-adapter-rollout
plan: 02
subsystem: adapters-global
tags: [adapters, claude-code, antigravity, codex, qcoder, generic-mcp, installer]
requires:
  - phase: 04-multi-platform-adapter-rollout
    provides: AdapterFactory, HostAdapterContract, IDEInstaller (from plan 03)
provides:
  - ClaudeCodeAdapter injecting into ~/.claude.json
  - AntigravityAdapter injecting into ~/.antigravity/config.json
  - CodexAdapter injecting into ~/.codex/config.json
  - QCoderAdapter injecting into ~/.qcoder/config.json
affects: [adapters, install-ux, mcp-server]
tech-stack:
  added: []
  patterns:
    - All global adapters delegate install/uninstall to IDEInstaller with platform-specific config paths
key-files:
  created: []
  modified:
    - src/adapters/global/claudeCode.ts
    - src/adapters/global/antigravity.ts
    - src/adapters/global/codex.ts
    - src/adapters/global/qcoder.ts
key-decisions:
  - "All global adapters delegate to IDEInstaller rather than implementing file I/O directly — keeps install logic centralized."
  - "Antigravity config path follows ~/.antigravity/config.json convention; Codex uses ~/.codex/config.json; QCoder uses ~/.qcoder/config.json."
patterns-established:
  - "Global adapters extend GenericMCPAdapter and override only install/uninstall with config-specific paths."
requirements-completed: [PLAT-01, PLAT-02, PLAT-06, PLAT-07]
duration: ~20min
completed: 2026-06-08
---

# Phase 04 Plan 02: Global Adapters (Claude Code, Codex, Antigravity, QCoder) Summary

**Global-config adapters with real file-system install/uninstall via IDEInstaller**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-08
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Replaced `console.log + return true` stubs in all four global adapters with real IDEInstaller calls.
- `ClaudeCodeAdapter.install()` writes to `~/.claude.json`.
- `AntigravityAdapter.install()` writes to `~/.antigravity/config.json`.
- `CodexAdapter.install()` writes to `~/.codex/config.json`.
- `QCoderAdapter.install()` writes to `~/.qcoder/config.json`.
- All adapters pass `"sessionmem"` + `["run"]` as the MCP server entry.

## Task Commits

1. **Global adapter install/uninstall wiring** - `f2d8029` (fix)

## Files Created/Modified

- `src/adapters/global/claudeCode.ts` - Injects/removes MCP block from `~/.claude.json`.
- `src/adapters/global/antigravity.ts` - Injects/removes MCP block from `~/.antigravity/config.json`.
- `src/adapters/global/codex.ts` - Injects/removes MCP block from `~/.codex/config.json`.
- `src/adapters/global/qcoder.ts` - Injects/removes MCP block from `~/.qcoder/config.json`.

## Decisions Made

- Config paths for Antigravity, Codex, QCoder use `~/.<name>/config.json` convention — standard dot-directory layout.

## Deviations from Plan

None. Plan specified install/uninstall wiring; executed exactly.

## Issues Encountered

All four files were stubs returning `true` without touching the filesystem. Replaced fully.

## Verification

- `npx vitest run tests/unit/adapters/adapter-factory.spec.ts --reporter=dot` — detection of all four adapters verified.
- `npm test` — 85 tests PASSED.

## User Setup Required

None — config paths are resolved at runtime from `homedir()`.

## Next Phase Readiness

Plan 03 builds IDE adapters (Cursor, Windsurf, Cline) using the same IDEInstaller pattern with platform-aware path resolution.

## Self-Check: PASSED

- FOUND: `src/adapters/global/claudeCode.ts` — uses IDEInstaller
- FOUND: `src/adapters/global/antigravity.ts` — uses IDEInstaller
- FOUND: `src/adapters/global/codex.ts` — uses IDEInstaller
- FOUND: `src/adapters/global/qcoder.ts` — uses IDEInstaller
- FOUND: commit `f2d8029`

---
*Phase: 04-multi-platform-adapter-rollout*
*Completed: 2026-06-08*
