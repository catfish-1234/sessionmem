---
phase: 04-multi-platform-adapter-rollout
plan: 04
subsystem: adapters-capabilities
tags: [adapters, fallback-tools, session, disconnect, capabilities, vitest]
requires:
  - phase: 04-multi-platform-adapter-rollout
    provides: HostAdapterContract with HostCapabilities flags
provides:
  - FallbackToolRegistrar with capability-based fetch_memories and startup_inject_memories registration
  - onSessionDisconnect() warning logger in src/core/session.ts
affects: [adapters, mcp-server, fallback-ux, limited-host-support]
tech-stack:
  added: []
  patterns:
    - Conditional tool registration driven by HostCapabilities flags at MCP server init time
key-files:
  created:
    - src/core/session.ts
    - tests/unit/adapters/fallback-tools.spec.ts
  modified:
    - src/adapters/capabilities/fallbackTools.ts
key-decisions:
  - "fetch_memories registered when supportsResources=false; startup_inject_memories registered when supportsPrompts=false."
  - "onSessionDisconnect logs a formatted warning and returns — never throws — so the caller loop continues uninterrupted."
patterns-established:
  - "Fallback tool list is computed pure-functionally from a HostCapabilities object — no side effects, fully testable."
requirements-completed: [PLAT-08]
duration: ~20min
completed: 2026-06-08
---

# Phase 04 Plan 04: Missing Capability Fallbacks Summary

**Capability-based fallback tool registration and session disconnect warning logger**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-08
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `FallbackToolRegistrar.getFallbackTools(capabilities)` returns `fetch_memories` when `supportsResources=false` and `startup_inject_memories` when `supportsPrompts=false`. Returns empty array for full-capability hosts.
- Created `src/core/session.ts` with `onSessionDisconnect(adapterName, error?)` that emits a structured warning and continues — missing from the original execution.
- Added 7 unit tests verifying all capability combinations including the Cursor case (both tools registered).

## Task Commits

1. **session.ts + fallback tools** - `3a856f0` (feat)
2. **fallback-tools unit tests** - `3a856f0` (feat)

## Files Created/Modified

- `src/core/session.ts` — `onSessionDisconnect(adapterName, error?)`: logs `[sessionmem] <adapter> disconnected (reason). Continuing.`
- `src/adapters/capabilities/fallbackTools.ts` — existing file with capability-conditional tool list (no change needed beyond tests).
- `tests/unit/adapters/fallback-tools.spec.ts` — 7 tests: full-caps=0 tools, no-resources=fetch_memories, no-prompts=startup_inject, minimal-host=both, Cursor caps=both, schema shape.

## Decisions Made

- `onSessionDisconnect` is a pure warning function — not integrated into adapters yet (MCP server wiring is Phase 5). Exported and ready for use.
- Fallback tool `execute()` functions are stubs returning strings — real core delegation happens when MCP server is wired in Phase 5.

## Deviations from Plan

`src/core/session.ts` was not created during the original Phase 4 execution — created now as part of gap closure.

## Issues Encountered

`session.ts` was entirely missing. Created from scratch.

## Verification

- `npx vitest run tests/unit/adapters/fallback-tools.spec.ts --reporter=dot` — 7 tests PASSED.
- `npm test` — 85 tests PASSED.

## User Setup Required

None.

## Next Phase Readiness

Plan 05 can wire `sessionmem_ping` and the install command, completing the manual fallback UX.

## Self-Check: PASSED

- FOUND: `src/core/session.ts`
- FOUND: `src/adapters/capabilities/fallbackTools.ts`
- FOUND: `tests/unit/adapters/fallback-tools.spec.ts`
- FOUND: commit `3a856f0`

---
*Phase: 04-multi-platform-adapter-rollout*
*Completed: 2026-06-08*
