---
phase: 04-multi-platform-adapter-rollout
plan: 01
subsystem: adapters
tags: [adapters, factory, env-detection, contract, typescript, vitest]
requires:
  - phase: 01-core-memory-engine-foundation
    provides: HostAdapterContract baseline, MemoryCoreMethod types, error envelopes
provides:
  - AdapterFactory with env-var-based host detection for 8 platforms
  - HostAdapterContract interface with HostCapabilities flags
  - GenericMCPAdapter as fallback returning ErrorResponseEnvelope on call()
affects: [adapters, cli, mcp-server]
tech-stack:
  added: []
  patterns:
    - Factory pattern for env-var-driven adapter resolution
    - HostCapabilities flags (supportsPrompts, supportsResources, supportsTools) on every adapter
key-files:
  created:
    - src/adapters/factory.ts
    - src/adapters/contract/hostAdapterContract.ts
    - src/adapters/generic.ts
    - tests/unit/adapters/adapter-factory.spec.ts
  modified: []
key-decisions:
  - "Antigravity detection takes priority over Claude Code when both env vars are set."
  - "GenericMCPAdapter.call() returns ErrorResponseEnvelope (INTERNAL) instead of throwing to keep the adapter contract safe."
patterns-established:
  - "All adapters expose capabilities object so fallback tool registration can inspect host support at runtime."
requirements-completed: [PLAT-08]
duration: ~30min
completed: 2026-06-08
---

# Phase 04 Plan 01: Core Adapter Factory and Auto-Detect Logic Summary

**Host env-var detection factory with capability-flagged adapter contract and generic MCP fallback**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-08
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `AdapterFactory.detectAdapter()` inspecting 8 env vars (ANTIGRAVITY_SESSION_ID, ANTIGRAVITY_APP_DATA_DIR, CLAUDE_CODE_SESSION, TERM_PROGRAM, CURSOR_APP_VERSION, CLINE_SESSION_ID, CODEX_SESSION_ID, QCODER_SESSION) with Antigravity-first priority order.
- Created `HostAdapterContract` interface with `HostCapabilities` flags, `call()`, `install?()`, `uninstall?()`, `startMcpServer?()`.
- Created `GenericMCPAdapter` returning `ErrorResponseEnvelope` on `call()` instead of throwing.
- Added 14 unit tests covering all detection rules, priority ordering, and capabilities shape.

## Task Commits

1. **Factory + contract + generic adapter** - `f2d8029` (fix)
2. **Adapter factory unit tests** - `3a856f0` (feat)

## Files Created/Modified

- `src/adapters/factory.ts` - Inspects env vars, returns typed adapter, falls back to Generic MCP.
- `src/adapters/contract/hostAdapterContract.ts` - Exports HostCapabilities, HostAdapterContract, result types.
- `src/adapters/generic.ts` - GenericMCPAdapter with error-envelope call() and startMcpServer stub.
- `tests/unit/adapters/adapter-factory.spec.ts` - 14 tests: all env var rules, priority, capabilities.

## Decisions Made

- Antigravity env vars checked before Claude Code to prevent misdetection when both are set.
- `call()` returns error envelope rather than throwing — safe default for pre-MCP-wiring state.

## Deviations from Plan

None.

## Issues Encountered

Original `generic.ts` threw `Error("Method not implemented.")` — replaced with error envelope return.

## Verification

- `npx vitest run tests/unit/adapters/adapter-factory.spec.ts --reporter=dot` — 14 tests PASSED.
- `npm test` — 85 tests across 23 files PASSED.

## User Setup Required

None.

## Next Phase Readiness

Plan 02 can build global adapters (ClaudeCode, Antigravity, Codex, QCoder) extending GenericMCPAdapter with real install/uninstall logic.

## Self-Check: PASSED

- FOUND: `src/adapters/factory.ts`
- FOUND: `src/adapters/contract/hostAdapterContract.ts`
- FOUND: `src/adapters/generic.ts`
- FOUND: `tests/unit/adapters/adapter-factory.spec.ts`
- FOUND: commit `f2d8029`

---
*Phase: 04-multi-platform-adapter-rollout*
*Completed: 2026-06-08*
