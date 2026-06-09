---
phase: 04-multi-platform-adapter-rollout
plan: 03
subsystem: adapters-ide
tags: [adapters, cursor, windsurf, cline, ide-installer, jsonc, vitest]
requires:
  - phase: 04-multi-platform-adapter-rollout
    provides: AdapterFactory, HostAdapterContract, GenericMCPAdapter base class
provides:
  - IDEInstaller with real JSONC parse, inject, and remove (pure string API + file I/O API)
  - CursorAdapter with platform-aware config path (win32/darwin/linux)
  - WindsurfAdapter with platform-aware config path
  - ClineAdapter writing to ~/.cline/config.json
affects: [adapters, install-ux, ide-config]
tech-stack:
  added: []
  patterns:
    - Pure string-manipulation layer (parseJsonc, injectMcpBlock, removeMcpBlock) enables unit testing without fs mocks
    - File I/O layer (injectMcpConfig, removeMcpConfig) wraps pure layer with dynamic fs import
key-files:
  created:
    - tests/unit/adapters/ide-installer.spec.ts
  modified:
    - src/adapters/ide/installer.ts
    - src/adapters/ide/cursor.ts
    - src/adapters/ide/windsurf.ts
    - src/adapters/ide/cline.ts
key-decisions:
  - "IDEInstaller exposes pure string methods (injectMcpBlock, removeMcpBlock) separately from file I/O so unit tests operate on strings without mocking fs."
  - "Cursor's supportsPrompts and supportsResources are false — triggers both fallback tools at runtime."
  - "CursorAdapter resolves Cursor settings.json path per platform: APPDATA on win32, Application Support on darwin, .config on linux."
patterns-established:
  - "JSONC stripping: strip // comments then trailing commas before JSON.parse."
  - "IDE adapters resolve platform path via process.platform check in a getter."
requirements-completed: [PLAT-03, PLAT-04, PLAT-05]
duration: ~25min
completed: 2026-06-08
---

# Phase 04 Plan 03: IDE Adapters (Cursor, Windsurf, Cline) + IDEInstaller Summary

**Real JSONC manipulation with platform-aware IDE config path resolution**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-08
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Replaced `IDEInstaller` stub with real JSONC manipulation: `parseJsonc` strips `//` comments and trailing commas, `injectMcpBlock` adds/replaces MCP server entry, `removeMcpBlock` removes it.
- Separated pure string API from file I/O so tests don't need fs mocks — 11 unit tests verify round-trips.
- `CursorAdapter` resolves platform-specific settings.json path (win32 / darwin / linux).
- `WindsurfAdapter` uses same platform-aware path pattern for Windsurf.
- `ClineAdapter` writes to `~/.cline/config.json`.

## Task Commits

1. **IDEInstaller real implementation + IDE adapters** - `f2d8029` (fix)
2. **IDEInstaller unit tests** - `3a856f0` (feat)

## Files Created/Modified

- `src/adapters/ide/installer.ts` - parseJsonc, injectMcpBlock, removeMcpBlock (pure), injectMcpConfig, removeMcpConfig (file I/O).
- `src/adapters/ide/cursor.ts` - Platform-aware config path, install/uninstall via IDEInstaller. supportsPrompts=false, supportsResources=false.
- `src/adapters/ide/windsurf.ts` - Platform-aware config path, install/uninstall via IDEInstaller.
- `src/adapters/ide/cline.ts` - ~/.cline/config.json path, install/uninstall via IDEInstaller.
- `tests/unit/adapters/ide-installer.spec.ts` - 11 tests: JSONC parsing, inject, remove, round-trip.

## Decisions Made

- Pure string layer is the testable contract; file I/O layer uses dynamic `import("fs")` inside async methods to stay ESM-compatible.
- Cursor intentionally sets `supportsPrompts: false` and `supportsResources: false` — reflects real Cursor MCP limitations and ensures fallback tools are activated.

## Deviations from Plan

None. Plan specified safe JSON parsing, injection, and extraction — delivered exactly.

## Issues Encountered

Original installer was a pure stub. Full replacement required.

## Verification

- `npx vitest run tests/unit/adapters/ide-installer.spec.ts --reporter=dot` — 11 tests PASSED.
- `npm test` — 85 tests PASSED.

## User Setup Required

None — paths resolved at runtime.

## Next Phase Readiness

Plan 04 can build fallback tools using `adapter.capabilities` to conditionally register `fetch_memories` and `startup_inject_memories`.

## Self-Check: PASSED

- FOUND: `src/adapters/ide/installer.ts` — real JSONC logic
- FOUND: `src/adapters/ide/cursor.ts` — platform path + IDEInstaller
- FOUND: `src/adapters/ide/windsurf.ts` — platform path + IDEInstaller
- FOUND: `src/adapters/ide/cline.ts` — IDEInstaller
- FOUND: `tests/unit/adapters/ide-installer.spec.ts` — 11 tests
- FOUND: commit `f2d8029`

---
*Phase: 04-multi-platform-adapter-rollout*
*Completed: 2026-06-08*
