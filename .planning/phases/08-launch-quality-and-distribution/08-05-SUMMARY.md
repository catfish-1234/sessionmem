---
phase: 08-launch-quality-and-distribution
plan: 05
type: summary
requirements: [QLTY-02]
status: complete
---

# Plan 08-05 Summary — CI Pipeline + Install-Smoke (QLTY-02)

## What was built

A new `.github/workflows/ci.yml`, additive to the existing `security.yml`, with
two jobs: a `checks` matrix (lint/typecheck/test/build) and a dependent
`install-smoke` matrix that packs, installs, and runs the real published
artifact end-to-end.

### Task 1 — `checks` job
- New file `.github/workflows/ci.yml` (name: CI). Reuses `security.yml`'s
  trigger block (`push: branches: [main]` + `pull_request`) and the
  `actions/checkout@v6` pin.
- `checks` job: `fail-fast: false`, matrix of `os: [ubuntu-latest,
  macos-latest, windows-latest] x node: [20, 22]` (full 3x2 per D-01).
- Steps in gate order: checkout, `actions/setup-node@v5` (matrix node version,
  `cache: npm`), `npm ci`, `npx eslint .`, `npx tsc --noEmit`, `npm test`,
  `npm run build`. `fail-fast: false` ensures a single cell's better-sqlite3
  native-compile failure (Pitfall 2) doesn't mask failures in other cells.

### Task 2 — `install-smoke` job
- `needs: checks`, same 3x2 matrix, `fail-fast: false`.
- Steps: checkout, setup-node (cache npm), `npm ci`, `npm run build`,
  `npm pack` (produces `sessionmem-1.0.0.tgz`).
- Global install of the packed tarball — separate POSIX (`npm install -g
  ./sessionmem-*.tgz`) and Windows pwsh (resolve filename via
  `Get-ChildItem`, since PowerShell doesn't glob-expand `npm install -g`
  args) steps gated on `runner.os`.
- Runs `sessionmem --version` and asserts it equals `1.0.0` (catches version
  drift, Pitfall 5) — POSIX bash and Windows pwsh variants.
- Runs `sessionmem ping`.
- Runs `sessionmem install` against an **isolated temp HOME** (Pitfall 3):
  - POSIX: `HOME=$(mktemp -d)`, then asserts
    `$HOME/.sessionmem/config.json` exists.
  - Windows: creates a temp dir under `$env:RUNNER_TEMP`, sets `HOME`,
    `USERPROFILE`, `HOMEDRIVE`, and `HOMEPATH` to point at it (since
    `os.homedir()` on Windows reads `USERPROFILE`/`HOMEDRIVE`+`HOMEPATH`, not
    `HOME`), then asserts `.sessionmem\config.json` exists under that temp
    dir.
- No step starts `sessionmem run` (the real stdio server) — binary execution
  limited to `--version`, `ping`, and `install` (Pitfall 1 / T-08-10).

## Verification
- Both plan verify node-scripts pass:
  - Task 1 tokens (`ubuntu-latest`, `macos-latest`, `windows-latest`,
    `eslint`, `tsc --noEmit`, `npm test`, `npm run build`) all present.
  - Task 2 tokens (`install-smoke`, `needs: checks`, `npm pack`,
    `sessionmem --version`, `sessionmem install`, `config.json`) all present.
- YAML parses successfully (validated with `python -c "yaml.safe_load(...)"`).
- `.github/workflows/security.yml` unchanged (D-04, additive only).

## Files
- `.github/workflows/ci.yml` (new) — CI pipeline: `checks` matrix +
  `install-smoke` matrix.

## Deviations
- None affecting scope. `security.yml` left untouched as required by D-04.
  Real CI matrix execution (3 OS x 2 Node, both jobs) will be validated on
  first push to `main`/PR — this workflow file IS the harness for D-02, so
  full validation happens in CI rather than locally.

## Requirements satisfied
- **QLTY-02** — CI runs lint, typecheck, test, and build on a 3-OS x 2-Node
  matrix, plus a dependent install-smoke job that packs, globally installs,
  and runs the published artifact (including `sessionmem install` against an
  isolated temp HOME), additive to `security.yml`.
