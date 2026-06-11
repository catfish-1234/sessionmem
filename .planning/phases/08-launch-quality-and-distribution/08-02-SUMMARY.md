---
phase: 08-launch-quality-and-distribution
plan: 02
status: complete
requirements: [QLTY-01, QLTY-02]
autonomous: false
---

# Plan 08-02 Summary — Lint Gate + Adapter Install Parity

## Status

**Complete.** All 3 tasks done and committed. Task 3 (`checkpoint:human-verify`,
Package Legitimacy Gate) was approved by the user.

## Completed Tasks

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | ESLint 10 flat-config lint gate (QLTY-02, D-03) | `b348397` | DONE |
| 2 | Adapter install() parity + generic path tests (QLTY-01) | `57a29a8` | DONE |
| 3 | Human-verify ESLint toolchain package legitimacy | — | APPROVED |

## What Was Built

### Task 1 — Lint gate (QLTY-02 / D-03)
- Added `eslint.config.mjs` (ESLint 10 flat config, the only form ESLint 10 supports):
  `js.configs.recommended` + non-type-checked `...tseslint.configs.recommended`
  (fast for CI — deliberately NOT `recommendedTypeChecked`, a RESEARCH anti-pattern),
  `ignores: dist/** node_modules/** coverage/**`, and a `tests/**/*.ts` override
  disabling `@typescript-eslint/no-explicit-any` + `no-control-regex`.
- Installed devDeps: `eslint@10.4.1`, `@eslint/js@10.0.1`, `typescript-eslint@8.61.0`,
  `globals@17.6.0`. Resolved cleanly — no ERESOLVE peer conflict, so the eslint@9
  fallback was not needed. None ship a postinstall script.
- Added scripts: `"lint": "eslint ."` and `"typecheck": "tsc --noEmit"`.
- Resolved the 26 real errors the first run surfaced instead of blanket-disabling:
  - `fallbackTools.ts`: typed `args` as `{ query: string }` instead of `any`.
  - `no-unused-vars`: honored the codebase's established `^_` ignore convention
    (`argsIgnorePattern` / `varsIgnorePattern` / `caughtErrorsIgnorePattern`) rather
    than renaming `_code`/`_method`/`_projectId` across many files.
  - `scripts/**/*.mjs` + `**/*.mjs`: added Node globals so `console`/`process` resolve.
  - tests: `no-control-regex` off (assertions legitimately match ANSI `\x1b` escapes).
  - `team.ts`: a single scoped `// eslint-disable-next-line no-useless-assignment`
    on one intentional defensive initializer (removing it would break TS definite-
    assignment guarantees).
- `npx eslint .`, `npm run lint`, and `npm run typecheck` all exit 0. No `.eslintrc*` created.

### Task 2 — Adapter install parity + generic path (QLTY-01)
- Added `tests/integration/adapters/install-parity.spec.ts` (3 tests, all passing):
  - Cursor (IDE adapter): `install()` writes `{ command: "sessionmem", args: ["run"] }`
    under `mcpServers.sessionmem`; `uninstall()` removes it.
  - Codex (global adapter): same parity assertion.
  - GenericMCPAdapter (PLAT-08): `.call("retrieveMemories", …)` with no running
    server returns `{ ok:false, error:{ code:"INTERNAL", message:/not initialized/ } }`.
- All filesystem writes isolated to a per-test `mkdtemp` dir by redirecting
  `HOME` / `USERPROFILE` / `APPDATA` (restored in `afterEach`). No real
  `~/.claude.json` / `~/.codex/config.json` / Cursor settings is ever touched.

## Deviations & Findings

- **Plan said request shape `queryText`/`topK`; actual schema is `query`/`limit`.**
  `retrieveMemoriesRequestSchema` (src/core/api/contracts.ts) uses `query` + `limit`
  (+ `mode`/`depth` with defaults). Test uses the real shape. (`GenericMCPAdapter.call`
  returns the error envelope unconditionally without validating, but the correct
  shape keeps the test type-safe.)
- **`IDEInstaller.injectMcpConfig` does not create parent directories** — it writes
  the config file but not the tree. In production the host app owns/creates that dir.
  The test pre-creates the parent dir (mirroring reality) before calling `install()`;
  otherwise `writeFileSync` fails and `install()` returns `false`. Noted as a possible
  hardening follow-up (not in this plan's scope).
- Added `globals` as an explicit devDep because `eslint.config.mjs` imports it for
  Node globals (it is otherwise only a transitive dep).

## Task 3 — Package Legitimacy Gate: APPROVED

`checkpoint:human-verify`. Installed / pinned versions:
- `eslint@10.4.1` — https://www.npmjs.com/package/eslint
- `typescript-eslint@8.61.0` — https://www.npmjs.com/package/typescript-eslint
- `@eslint/js@10.0.1` — https://www.npmjs.com/package/@eslint/js
- (`globals@17.6.0` added for Node globals in the flat config)

User confirmed these are the official packages with correct versions and no postinstall scripts. Approved — no code change required.

## Verification

- `npx eslint .` → exit 0
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npx vitest run tests/integration/adapters/install-parity.spec.ts` → 3 passed
