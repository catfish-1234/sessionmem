# Technology Stack

**Analysis Date:** 2026-06-10

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code in `src/` and tests in `tests/`
  - Compiler config: `tsconfig.json` - `module`/`moduleResolution`: `NodeNext`, `target`: `ES2022`, `strict`: true, `outDir`: `dist`, `rootDir`: `src`

**Secondary:**
- SQL - Database migrations in `src/core/schema/migrations/*.sql`
- YAML - GitHub Actions workflows (`.github/workflows/security.yml`), Dependabot config (`.github/dependabot.yml`), pre-commit config (`.pre-commit-config.yaml`)

## Runtime

**Environment:**
- Node.js (targeting Node 18+ based on ESM usage)

**Package Manager:**
- npm (package-lock.json present, lockfileVersion 3)
- Lockfile: Present (`package-lock.json`), package `sessionmem@0.1.0`

## Frameworks

**Core:**
- better-sqlite3 12.4.1 - SQLite database driver for local storage
- js-tiktoken 1.0.21 - Token counting for budget management

**Validation:**
- Zod 4.4.3 - Schema validation for API contracts

**Testing:**
- Vitest 4.0.8 - Test runner
- chai - Assertion library (via @types/chai)
- @vitest/* - Various vitest utilities

**Build:**
- TypeScript compiler (`tsc`) via `tsconfig.json` - compiles `src/**/*.ts` to `dist/`, excludes `tests`, `dist`, `node_modules`

## Key Dependencies

**Critical:**
- better-sqlite3 12.4.1 - Local SQLite database for memory/event storage
- js-tiktoken 1.0.21 - Token counting for injection budget trimming
- zod 4.4.3 - Runtime validation of API contracts

**Infrastructure:**
- @types/better-sqlite3 7.6.13 - TypeScript types for SQLite

## Configuration

**Environment:**
- Environment-based detection (process.env checks in AdapterFactory)
- No .env file processing currently

**Build:**
- `tsconfig.json` - NodeNext module resolution, ES2022 target, strict mode enabled, output to `dist/`

**Repo hygiene / ignored paths:**
- `.gitignore` - ignores `node_modules/` and `*.log` only (note: `dist/` build output is not gitignored)

## CI/CD & Tooling Configuration

**GitHub Actions:**
- `.github/workflows/security.yml` - "Security Scan" workflow, runs on push to `main` and on pull requests
  - Steps: `actions/checkout@v6` (full history fetch via `fetch-depth: 0`), Semgrep (`semgrep/semgrep-action@v1`, auto config), Gitleaks (`gitleaks/gitleaks-action@v3`), Trivy filesystem scan (`aquasecurity/trivy-action@master`, severity HIGH/CRITICAL, `exit-code: 1` fails the build on findings)

**Dependabot:**
- `.github/dependabot.yml` - weekly update schedule for two ecosystems: `npm` (root directory `/`) and `github-actions` (root directory `/`)

**Pre-commit hooks:**
- `.pre-commit-config.yaml` - single hook: `gitleaks` (rev `v8.18.4`) for secret scanning before commit

**Skills/agent tooling:**
- `skills-lock.json` - locks 7 skills sourced from `JuliusBrussee/caveman` GitHub repo: `cavecrew`, `caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `caveman-review`, `caveman-stats` (each pinned via `computedHash`)

## Platform Requirements

**Development:**
- Node.js 18+
- npm for dependency management
- TypeScript 5.9.3 with strict mode (NodeNext modules)

**Production:**
- Node.js runtime
- SQLite support via better-sqlite3 (native module)

---

*Stack analysis: 2026-06-10*
