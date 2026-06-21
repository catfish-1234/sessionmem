---
phase: 15-audit-adapter-cli-fixes
plan: 02
subsystem: adapters
tags: [mcp, fallback-tools, wiring]
dependency_graph:
  requires: []
  provides: [fallback-tool-execute-bodies, fallback-tool-mcp-registration]
  affects: [generic-mcp-adapter, cursor-adapter, windsurf-adapter]
tech_stack:
  added: []
  patterns: [service-context-injection, zod-input-shapes]
key_files:
  created: []
  modified:
    - src/adapters/capabilities/fallbackTools.ts
    - src/adapters/generic.ts
    - tests/unit/adapters/fallback-tools.spec.ts
    - tests/unit/adapters/run-command.spec.ts
decisions:
  - Used Zod shapes (inputShape) instead of plain JSON schema objects for MCP SDK registerTool compatibility
  - Set fetch_memories mode to on-demand and startup_inject_memories mode to auto to match their semantic use cases
metrics:
  duration: 339s
  completed: 2026-06-21T04:17:09Z
  tasks_completed: 4
  tasks_total: 4
  files_modified: 4
---

# Phase 15 Plan 02: Wire Fallback Tools into MCP Server Summary

Wired fetch_memories and startup_inject_memories fallback tools with real service.call("retrieveMemories") execute bodies and registered them in the MCP server via startMcpServer().

## What Was Done

### Task 1: Update getFallbackTools signature and implement execute bodies
- Changed `getFallbackTools` signature to accept `context: { service, projectId }` alongside capabilities
- Implemented `fetch_memories.execute`: calls `service.call("retrieveMemories")` with query, returns `JSON.stringify(result.memories)`
- Implemented `startup_inject_memories.execute`: calls `service.call("retrieveMemories")` with startup query, returns `result.startupInjection`
- Added `createMemoryCoreService` type import for context typing
- Commit: `58b1fe5`

### Task 2: Wire fallback tools into startMcpServer
- Added `FallbackToolRegistrar` import to generic.ts
- After the TOOL_DEFINITIONS registration loop, added fallback tool registration using `FallbackToolRegistrar.getFallbackTools(this.capabilities, { service, projectId })`
- Each fallback tool is registered via `server.registerTool` with its description, inputShape, and an async callback that wraps execute output in MCP text content
- Commit: `2488c88`

### Task 3: Update fallback-tools.spec.ts tests
- Added `mockContext` with mock `service.call` returning `{ ok: true, memories: [], total: 0, startupInjection: "" }`
- Updated all `getFallbackTools` calls to pass `mockContext` as second argument
- Added execute body tests: fetch_memories returns JSON string, error handling returns error message, startup_inject_memories returns startupInjection
- Commit: `3bf4fa3`

### Task 4: Update run-command.spec.ts and fix TypeScript errors
- Updated `getFallbackTools(cursorCaps)` to `getFallbackTools(cursorCaps, mockContext)` in run-command tests
- Fixed TypeScript errors: used Zod shapes (inputShape) instead of plain JSON schema for MCP SDK registerTool compatibility
- Added required `mode` and `depth` params to retrieveMemories calls
- Fixed implicit `any` type on fallback registration callback
- Commit: `34db385`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed schema to Zod inputShape for MCP SDK compatibility**
- **Found during:** Task 4 verification (npx tsc --noEmit)
- **Issue:** MCP SDK's `registerTool` expects `inputSchema` to be `ZodRawShapeCompat | AnySchema`, not a plain JSON Schema object. The plan specified plain JSON `schema` objects for fallback tools.
- **Fix:** Changed fallback tools from `schema: { type: "object", properties: ... }` to `inputShape: { query: z.string() }` using Zod, matching the pattern used by TOOL_DEFINITIONS. Updated generic.ts to pass `fallback.inputShape` instead of `fallback.schema`. Updated test assertions from `schema.properties` to `inputShape`.
- **Files modified:** src/adapters/capabilities/fallbackTools.ts, src/adapters/generic.ts, tests/unit/adapters/fallback-tools.spec.ts
- **Commit:** 34db385

**2. [Rule 3 - Blocking] Added required mode/depth params to retrieveMemories calls**
- **Found during:** Task 4 verification (npx tsc --noEmit)
- **Issue:** `retrieveMemories` request schema requires `mode` and `depth` fields (even though they have Zod defaults, TypeScript infers them as required in the type). Plan omitted these.
- **Fix:** Added `mode: "on-demand"` for fetch_memories and `mode: "auto"` for startup_inject_memories, both with `depth: "default"`.
- **Files modified:** src/adapters/capabilities/fallbackTools.ts
- **Commit:** 34db385

## Verification

- `npx tsc --noEmit`: Clean (zero errors)
- `npm test`: 312 tests passed, 11 skipped, 59/61 test files passed (2 pre-existing integration failures requiring `npm run build`)
