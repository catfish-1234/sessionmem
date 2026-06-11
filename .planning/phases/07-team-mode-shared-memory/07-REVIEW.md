---
phase: 07-team-mode-shared-memory
reviewed: 2026-06-11T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - docs/team-mode.md
  - src/cli/commands/sync.ts
  - src/cli/commands/team.ts
  - src/cli/context.ts
  - src/cli/index.ts
  - src/core/api/contracts.ts
  - src/core/api/memoryCoreService.ts
  - src/core/api/sessionLifecycleService.ts
  - src/core/config/policyConfig.ts
  - src/core/injection/formatStartupInjection.ts
  - src/core/retrieve/retrieveMemories.ts
  - src/core/schema/migrations/005_team_provenance.sql
  - src/core/storage/memoryRepo.ts
  - src/core/storage/memorySearchRepo.ts
  - src/core/storage/types.ts
  - tests/helpers/cliTestContext.ts
  - tests/integration/cli/sync.spec.ts
  - tests/integration/cli/team.spec.ts
  - tests/integration/docs/team-docs.spec.ts
  - tests/integration/storage/schema.spec.ts
  - tests/unit/core/author-stamp.spec.ts
  - tests/unit/core/policy-config.spec.ts
  - tests/unit/core/pull-merge.spec.ts
  - tests/unit/injection/author-annotation.spec.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-06-11
**Depth:** standard
**Files Reviewed:** 21 (excluding lockfiles/planning artifacts; `tests/unit/injection/author-annotation.spec.ts` and `cliTestContext.ts` reviewed as test support)
**Status:** issues_found

## Summary

The phase implements team-mode shared memory: config schema, `team enable/disable/status`, `sync` (push/pull), provenance columns (`author`/`origin_project_id`), MAX-importance LWW merge in `pullMemories`, cross-project id-collision skipping, re-redaction on pull, and an author-prefix annotation in `formatStartupInjection`. Most of the core sync/merge/config logic is solid and well-covered by tests (LWW, importance preservation, cross-project skip, re-redaction, atomic write/rename, corrupt-file skip-and-warn).

However, two significant problems were found:

1. The headline "author: prefix in startup injection" feature (the entire point of `formatStartupInjection`'s new `localUsername` option, and the centerpiece of the docs' "Provenance and author annotation" section) is **never wired into the production retrieval/MCP path** — it is exercised only by its own unit test. Real agent sessions will never see the `author:` prefix described in `docs/team-mode.md`.

2. `team disable --remove-team-memories` deletes rows where `author != username`, which also captures **legacy rows with `author = ''`** (pre-migration-005 rows that predate provenance). The documented behavior ("leaving only the memories you authored locally") is violated for any project containing pre-Phase-7 memories — those legacy local memories get deleted even though they were authored locally, just before provenance stamping existed.

## Critical Issues

### CR-01: Author-prefix injection feature is not wired into any production call site

**File:** `src/core/injection/formatStartupInjection.ts:60-73` (new `authorPrefix`/`localUsername` logic), and absence of any caller in `src/core/api/memoryCoreService.ts:339-355` / `src/cli/commands/search.ts`

**Issue:** `docs/team-mode.md` (lines 74-91) documents that "When a teammate's memory is surfaced in the agent's startup context, it is shown with an `author:` prefix". This is implemented in `formatStartupInjection` via the new `localUsername` option and `authorPrefix()` helper, and is unit-tested in `tests/unit/injection/author-annotation.spec.ts`.

However, a repo-wide search shows `formatStartupInjection` is called **only** from its own unit tests (`tests/unit/injection/author-annotation.spec.ts`, `tests/unit/injection/format-startup-injection.spec.ts`, and the quality harness spec). No production code path — not `memoryCoreService.retrieveMemories`, not `cli/commands/search.ts`, not any MCP server handler — calls `formatStartupInjection` at all, with or without `localUsername`.

This means:
- The documented author-prefix annotation never appears in real agent startup context or search output.
- The entire "Provenance and author annotation" section of `docs/team-mode.md` describes behavior that does not exist in the shipped product.
- `tests/integration/docs/team-docs.spec.ts` only checks that the doc *contains* certain strings — it does not verify the behavior is actually reachable, so this gap passes CI undetected.

**Fix:** Wire `formatStartupInjection` (with `localUsername` set to the local OS username, e.g. via `localUsername()` from `src/cli/context.ts` or the service's resolved `localAuthor`) into the actual retrieval/startup-injection call path that produces agent-facing context — most likely inside `memoryCoreService.retrieveMemories` (or wherever the MCP server formats the startup injection block from `retrieveMemories` results). At minimum, add an integration test that drives the real retrieval path end-to-end and asserts the `author:` prefix appears in the rendered output for a teammate-authored memory.

---

### CR-02: `team disable --remove-team-memories` deletes legacy local rows with empty author

**File:** `src/cli/commands/team.ts:98-107`

**Issue:**
```ts
const result = context.db
  .prepare("DELETE FROM memories WHERE project_id = ? AND author != ?")
  .run(context.projectId, context.username);
```

Migration `005_team_provenance.sql` backfills `author = ''` for all pre-existing rows (`ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT ''`). For any project that existed before this phase shipped, locally-authored memories created prior to the migration have `author = ''`, not `author = context.username`.

`'' != context.username` is true for any non-empty username, so the `DELETE` statement above will also delete these legacy locally-authored rows. The documented behavior is:

> "This deletes the teammate-authored memories for this project, leaving only the memories you authored locally." (`docs/team-mode.md:120-127`)

For any pre-existing project, running `team disable --remove-team-memories` will silently delete the user's own pre-Phase-7 memories alongside genuine teammate rows — a data-loss bug contradicting the documented guarantee. `formatStartupInjection`'s own author-rendering logic (`tests/unit/injection/author-annotation.spec.ts:55-63`) explicitly treats `author === ""` as "local/legacy, no prefix" — i.e., the rest of the codebase already recognizes `''` as "mine", but `team.ts`'s delete does not.

**Fix:** Treat empty author as local/own, matching the convention used elsewhere (e.g. `formatStartupInjection`'s `authorPrefix`):
```ts
const result = context.db
  .prepare(
    "DELETE FROM memories WHERE project_id = ? AND author != ? AND author != ''",
  )
  .run(context.projectId, context.username);
```
Add a regression test seeding a legacy row with `author = ''` for the project and asserting it survives `--remove-team-memories`.

## Warnings

### WR-01: `sync` pull treats `author: null` (not just absent/empty) as "no author", silently re-stamping local username

**File:** `src/cli/commands/sync.ts:113-124`, `src/core/api/contracts.ts:131` (`author: z.string().nullable().optional()`), `src/core/api/memoryCoreService.ts:630-633`

**Issue:** `importMemoryRecordSchema.author` is `z.string().nullable().optional()` specifically because `exportMemories` emits `author: ""` for local rows (per the comment at `contracts.ts:128-130`), not `null`. But `pullMemories`'s author-stamping check is:
```ts
author:
  memory.author && memory.author.trim() !== ""
    ? memory.author
    : localAuthor,
```
`memory.author && ...` is falsy for both `null` and `""`/`undefined`, so `null` author values fall through to `localAuthor` — i.e. a teammate's exported snapshot containing `author: null` for a row gets re-stamped with the **pulling user's** username rather than being treated as "unknown/legacy author from the teammate's machine". This is a minor provenance-accuracy issue (the schema explicitly carves out `.nullable()` for round-tripping, but the merge logic doesn't distinguish "teammate's legacy local row" from "my own row"), but it means a teammate's pre-Phase-7 memories synced to you will be misattributed to you, not to them, when surfaced.

**Fix:** Decide and document the intended semantics for `author === null` vs `author === ""` on pull. If `null`/`""` both mean "the exporting teammate had no author for this row", consider stamping with the snapshot's filename-derived username (the `{username}.json` the row was read from) rather than the pulling user's `localAuthor`, since `sync.ts` already knows which teammate file each record came from but discards that information before calling `pullMemories`.

---

### WR-02: `team status` writability check (`accessSync(..., W_OK)`) is unreliable on Windows

**File:** `src/cli/commands/team.ts:66-72`

**Issue:** `accessSync(sharedPath, constants.W_OK)` on Windows does not reliably reflect actual write permission for a directory in many configurations (NTFS ACL semantics differ from POSIX `access()`, and Node's `fs.access` on Windows largely ignores `W_OK`/`R_OK` for directories, often returning success regardless of ACLs). Given `docs/team-mode.md` explicitly frames OS filesystem ACLs as "the real security boundary" and the project targets Windows (per env), `team status` may report "writable" for a shared path the user cannot actually write to, giving a false sense of reachability before `sync` fails.

**Fix:** Either document this caveat explicitly in `docs/team-mode.md`'s "Failure recovery" section, or perform a more reliable probe (e.g., attempt to create and remove a temp file in `sharedPath` and report based on that, falling back to `accessSync` only if the probe itself errors unexpectedly).

---

### WR-03: `sync` pull does not cap or validate the number/size of pulled memories from teammate snapshots

**File:** `src/cli/commands/sync.ts:96-125`

**Issue:** `sync` reads every `*.json` file in `{sharedPath}/{projectId}/`, parses each as JSON, and validates each record against `importMemoryRecordSchema`, accumulating all valid records into a single `memories` array passed to `pullMemories` in one call. There is no upper bound on the number of teammate files, the size of any individual file, or the total number of records pulled in one `sync` invocation. Per `docs/team-mode.md`'s trust-boundary section, "anyone who can write to the shared path can inject memories that your agent may surface" — a malicious or buggy teammate snapshot with an extremely large array (e.g. millions of records) would cause `sync` to read the entire file into memory (`readFileSync` + `JSON.parse`), validate every record, and pass the full array to `pullMemories`, which iterates and re-embeds every record synchronously. This is a potential resource-exhaustion vector from a shared-write-access teammate (consistent with the documented trust model, but not mentioned as a limitation).

**Fix:** Consider adding a configurable cap on per-file record count and/or total pulled records per `sync`, with a skip-and-warn message when exceeded, consistent with the existing skip-and-warn pattern for corrupt files/records.

## Info

### IN-01: `localUsername()` and `resolveServiceUsername()` duplicate sanitization logic

**File:** `src/cli/context.ts:38-56`, `src/core/api/memoryCoreService.ts:84-93`

**Issue:** Both functions independently implement `userInfo().username` retrieval with a try/catch fallback and the same `.replace(/[^A-Za-z0-9._-]/g, "_")` sanitization regex. `localUsername()` additionally falls back to `"user"` when the sanitized result is empty, while `resolveServiceUsername` falls back to `""`. The duplication is acknowledged in a comment (`memoryCoreService.ts:79-83`) but the divergent empty-fallback (`"user"` vs `""`) is a subtle behavioral difference that could cause confusion if the two are ever expected to agree (e.g., comparing `context.username` from the CLI against the service's `localAuthor` for the same process).

**Fix:** Extract a shared `sanitizeUsername(raw: string): string` helper used by both, with each call site applying its own empty-fallback explicitly, to make the divergence intentional and visible at the call sites rather than buried in two near-duplicate implementations.

---

### IN-02: `pullMemories` `origin_project_id` fallback can record the *pulling* user's own projectId as "origin" for self-authored records

**File:** `src/core/api/memoryCoreService.ts:634-637`

**Issue:**
```ts
// origin_project_id records the record's source-machine project_id:
// its explicit originProjectId if present, else the record's own
// incoming projectId (Open Q4).
origin_project_id: memory.originProjectId ?? memory.projectId,
```
If a user's own snapshot somehow gets included in their own pull set (e.g. a future bug in the `sync` filename-skip logic, or a manually-constructed snapshot), a record with `author === localAuthor` (i.e., a row that is "mine" but happens to flow through `pullMemories`) would get `origin_project_id` set to `memory.projectId` even though it didn't actually originate elsewhere. This is currently guarded against by `sync.ts`'s filename filter (`f !== \`${context.username}.json\``), so it's not reachable today, but `pullMemories` itself has no defense-in-depth check that `memory.author !== localAuthor` before stamping `origin_project_id`. Low risk given current callers, but worth noting as the merge function's contract is broader than its single caller.

**Fix:** No action required unless `pullMemories` gains additional callers; if so, consider an explicit guard or comment documenting the invariant that `pullMemories` assumes its input never contains the local user's own previously-exported records.

---

_Reviewed: 2026-06-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
