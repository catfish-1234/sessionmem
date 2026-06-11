# Phase 8: Launch Quality and Distribution - Research

**Researched:** 2026-06-11
**Domain:** Release engineering — CI matrix, test-coverage gap closure, docs authoring + coverage tests, reproducible benchmark scripts, npm publish automation, MCP registry / Claude Code plugin distribution
**Confidence:** HIGH (CI, npm publish, docs, plugin/registry formats — verified against official docs); MEDIUM (benchmark framing, coverage-gap specifics — codebase-grounded but judgment-driven)

## Summary

Phase 8 is a release-engineering phase, not a feature phase. The core engine, CLI, adapters, retrieval/injection, summarization, redaction/retention, and team mode are all complete (19/35 v1 reqs done; Phases 1-7 closed). What remains is making the project *launch-grade and distributable*: close meaningful test gaps, add a real CI pipeline (`ci.yml`) alongside the existing `security.yml`, write the missing entry-point docs (`README.md`, `architecture.md`, `troubleshooting.md`, `migration.md`) with mirror coverage tests, produce a reproducible benchmark report, flip `package.json` from `private:true`/`0.1.0` to a publishable `sessionmem@1.0.0` with MIT license, automate tag-triggered npm publish, and submit distribution artifacts to the official MCP Registry and a Claude Code plugin marketplace.

**One blocking discovery dominates this phase:** the MCP server is a **stub**. `src/adapters/generic.ts::startMcpServer()` only logs `"Starting Generic MCP Server over stdio..."` and never wires `@modelcontextprotocol/sdk` — there is no protocol handshake, no tool registration over stdio, and the SDK is not even a dependency. This is documented as known tech debt in `.planning/codebase/CONCERNS.md`, `ARCHITECTURE.md`, and `INTEGRATIONS.md`. It directly constrains two D-decisions: (a) the install-smoke job (D-02) cannot meaningfully "run the installed binary" as an MCP server because there is no server to run, and (b) MCP Registry / Smithery / plugin-marketplace submission (D-16) advertises an MCP server that does not actually function. **The planner must decide explicitly** whether Phase 8 implements the real stdio MCP server (scope expansion, but arguably required for an honest "launch" and for D-02/D-16) or whether D-02 is narrowed to CLI-only smoke and D-16 is descoped/deferred. This decision needs the user (see Open Questions Q1 and Assumptions Log A1).

**Primary recommendation:** Structure the phase as ~6 plans — (1) ESLint + `ci.yml` lint/typecheck/test/build, (2) install-smoke job + the MCP-server decision, (3) test-coverage gap closure, (4) docs set + coverage tests, (5) benchmark script + `docs/benchmark.md`, (6) npm publish prep + `release.yml` + distribution artifacts. Use ESLint 10 flat config with `typescript-eslint`, npm **trusted publishing (OIDC)** instead of a long-lived `NPM_TOKEN` where possible (it also gives free provenance), and the official `mcp-publisher` CLI + `server.json` for registry submission.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lint / typecheck / unit+integration test gates | CI (GitHub Actions) | Dev local (`npm` scripts) | CI is the enforcement boundary; scripts make it locally reproducible |
| Install-smoke (pack → global install → run binary → `install` against temp dir) | CI (matrix runner) | CLI (`src/cli`) | Validates the *packaged* artifact as a user would experience it, per-OS |
| MCP server runtime (stdio protocol) | Adapter layer (`src/adapters`) | Core API (`src/core/api`) | The server is the adapter's job; it dispatches to the already-complete core service |
| Docs authoring | Repo root + `docs/` | — | Static content; no runtime tier |
| Docs drift protection | Test tier (`tests/integration/docs`) | — | Coverage specs assert required tokens/sections exist |
| Benchmark measurement | Script tier (`scripts/`) | Core retrieve/inject (`src/core`) | A reproducible script drives the real core code paths and writes a report |
| Package publish | CI (`release.yml`) + npm registry | — | Tag-triggered automation; npm hosts the artifact |
| Distribution metadata (registry/plugin) | Repo artifacts (`server.json`, `.claude-plugin/`) + external registries | — | Metadata points at the npm artifact; external hubs host listings |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**CI Pipeline (QLTY-02)**
- **D-01:** CI matrix covers Ubuntu + macOS + Windows, each on Node 20 and 22 (full 3x2 matrix).
- **D-02:** Add a new "install smoke" job/step that does it all: `npm run build`, then `npm pack` + global install (or equivalent), run the installed `sessionmem` binary (`--version`/`ping`), AND run `sessionmem install` end-to-end against a temp dir to verify config/hooks get written for at least one adapter (e.g. Claude Code).
- **D-03:** Add ESLint as a new lint step (no lint config currently exists) — TS-aware config, runs as its own CI gate alongside `tsc` typecheck and `vitest run`.
- **D-04:** Existing `security.yml` (Semgrep/Gitleaks/Trivy) stays as-is; the new CI work is a separate workflow (e.g. `ci.yml`) for lint/typecheck/test/build/install-smoke.

**Test Coverage (QLTY-01) — Claude's Discretion**
- No specific gray area was discussed for QLTY-01 directly — there's already substantial coverage (`tests/unit/**`, `tests/integration/**`, `tests/quality/**`). Researcher/planner should do a gap analysis against "core flows and adapters" (per success criterion 1) and close meaningful gaps rather than padding coverage numbers.

**Docs Gap Closure (QLTY-03)**
- **D-05:** Create a top-level `README.md` (currently missing) as the main entry point — quickstart/install instructions, links out to `docs/` for deep dives.
- **D-06:** Add `docs/architecture.md` — high-level overview + diagram of core engine, adapters, CLI, storage. Conceptual map, not a deep module-by-module walkthrough.
- **D-07:** Add `docs/troubleshooting.md` — common issues and fixes (install failures, adapter issues, etc.).
- **D-08:** Add `docs/migration.md` covering BOTH: (a) how the SQLite migration system works (`scripts/copy-migrations.mjs`, migrations dir) for contributors/operators, AND (b) a version-upgrade policy/guide section for users (template-level for v1 since there's no prior released version).
- **D-09:** Add doc-coverage tests mirroring the existing pattern (`tests/integration/docs/privacy-docs.spec.ts`, `team-docs.spec.ts`) — one new spec per new doc (README, architecture, troubleshooting, migration), each checking the doc exists with required sections.

**Benchmark Report (QLTY-04)**
- **D-10:** Token-reduction measurement is Claude's discretion on framing — run BOTH (a) injected-context-vs-full-history-baseline comparison AND (b) realistic-scenario token measurements; present whichever framing produces the stronger, more defensible reduction story in the report.
- **D-11:** Retrieval-relevance measurement uses a curated query/expected-memory fixture set with hit-rate (precision/recall-style) scoring — reuse patterns from existing `tests/integration/retrieve/retrieve-ranked.spec.ts`-style fixtures where possible.
- **D-12:** Benchmark report lives at `docs/benchmark.md`, generated by a script (`npm run benchmark`) so it's reproducible and can be re-run when retrieval/injection logic changes.

**npm Publish & Marketplace (QLTY-05)**
- **D-13:** Publish unscoped as `sessionmem` on npm (matches current `package.json` name) — verify name availability during planning/execution; if taken, fall back to a scoped name.
- **D-14:** Bump version to `1.0.0` for launch; add MIT `LICENSE` file and set `"license": "MIT"` in `package.json`. Set `"private": false`, add `repository`/`author`/`files`/`publishConfig` fields as needed.
- **D-15:** Add `.github/workflows/release.yml` — on `v*` tag push, build + test, then `npm publish` using an `NPM_TOKEN` secret. This is new automation (currently only `security.yml` exists).
- **D-16:** Marketplace/hub submission artifacts target BOTH general MCP server registries (e.g. official MCP servers list, Smithery, mcp.so — researcher to confirm current active ones) AND any Claude Code plugin marketplace manifest/listing format. Researcher should confirm current submission requirements for each before planner scopes the artifacts.

### Claude's Discretion
- QLTY-01 gap analysis framing (see Test Coverage above and the Gap Analysis section below).
- ESLint config shape, README structure, architecture diagram format (CONTEXT `<specifics>` explicitly defers to standard approaches).
- Benchmark token-reduction framing (D-10).

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QLTY-01 | Maintainer has unit and integration tests covering core memory flows and adapters | Gap Analysis section maps existing 52 specs (21 unit / 30 integration / 1 quality) to flows; identifies concrete uncovered areas (real MCP server, `export`/`import` round-trip edge cases, adapter `install` for IDE adapters, generic adapter path PLAT-08) |
| QLTY-02 | CI passing lint, typecheck, tests, install-smoke on major OSes | `ci.yml` design (3×2 matrix), ESLint 10 flat config, install-smoke job design, the `npm pack` global-install pattern, and the stub-MCP-server constraint on what "run the binary" can verify |
| QLTY-03 | Docs for install, architecture, privacy/security, troubleshooting, migration | Existing doc style (`privacy-and-retention.md`) + coverage-test pattern (`privacy-docs.spec.ts`) extracted as a reusable template; privacy/security already covered by `docs/privacy-and-retention.md` |
| QLTY-04 | Benchmark showing token reduction + retrieval relevance | `formatStartupInjection` + `countTokens` (`tokenBudget.ts`) drive token measurement; `retrieve-ranked.spec.ts` + `injection-quality-harness.spec.ts` fixture patterns drive relevance hit-rate scoring; `scripts/benchmark.mjs` writes `docs/benchmark.md` |
| QLTY-05 | npm package published + submitted to plugin/marketplace hubs | npm trusted-publishing/OIDC + provenance flow; `release.yml` design; official MCP Registry `mcp-publisher` + `server.json`; Claude Code `.claude-plugin/marketplace.json` + `plugin.json` formats |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` exists at the project root (verified: `ls CLAUDE.md` → not found). No `.claude/skills/` or `.agents/skills/` `SKILL.md` files apply to this phase's authoring (`skills-lock.json` pins external skills but imposes no coding directives on Phase 8 work). Therefore no CLAUDE.md-derived directives constrain planning. The de-facto project conventions extracted from the codebase (treat with locked-decision authority):
- **TypeScript, strict mode, ESM (`NodeNext`).** `tsconfig.json` has `"strict": true`. New code must typecheck cleanly.
- **vitest is the test runner.** New tests use vitest; CI test step is `vitest run`.
- **Local-first / no mandatory cloud.** Out-of-scope table in REQUIREMENTS.md forbids mandatory cloud services. Benchmark and smoke tests must run offline.
- **Secret-safe.** `security.yml` (Gitleaks) and `.gitleaks.toml` exist; never commit tokens. Release secrets live in GitHub Actions secrets / OIDC, never in the repo.
- **`.js` import specifiers** in TS source (NodeNext requires explicit extensions). New source files follow this.

## Standard Stack

### Core (new dev dependencies for this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `eslint` | 10.4.1 | Lint engine (D-03) | The standard JS/TS linter; v10 is flat-config-only (`.eslintrc` removed) `[VERIFIED: npm registry — npm view eslint version]` `[CITED: typescript-eslint.io/getting-started]` |
| `typescript-eslint` | 8.61.0 | TS-aware ESLint config + parser + plugin (single meta-package) | Official integration; `tseslint.config()` helper + `recommended` preset is the documented path `[VERIFIED: npm registry]` `[CITED: typescript-eslint.io/getting-started]` |
| `@eslint/js` | 10.0.1 | ESLint's own JS recommended ruleset (`js.configs.recommended`) | Pairs with typescript-eslint in the documented flat config `[VERIFIED: npm registry]` `[CITED: typescript-eslint.io/getting-started]` |
| `@vitest/coverage-v8` | 4.1.8 | Coverage provider for vitest (matches installed vitest 4.1.8) | Already in `package-lock.json`; v8 provider is vitest's default coverage path `[VERIFIED: package-lock.json + npm view]` |

> **Version-compat note:** `eslint@10` is newer than the `eslint@^9` that `typescript-eslint@8` documents as its primary peer. typescript-eslint v8 is broadly compatible with ESLint 9 and 10, but pin and run `npm run lint` once locally before trusting it. If a peer conflict surfaces, the safe fallback is `eslint@^9` (well-supported, flat-config) — there is no functional requirement forcing v10. `[ASSUMED — compat across the exact 10.4.1 / 8.61.0 pair not run in this session]`

### Supporting (potential, depends on MCP-server decision)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | Real stdio MCP server (`McpServer` + `StdioServerTransport`) | ONLY if the planner/user decides Phase 8 implements the real server (Open Q1). It is the official SDK and was the planned baseline in `.planning/research/STACK.md`. `[VERIFIED: npm registry]` `[CITED: modelcontextprotocol.io]` |

### Tooling installed at CI runtime (not npm deps)
| Tool | Source | Purpose | Notes |
|------|--------|---------|-------|
| `mcp-publisher` | GitHub release binary / Homebrew | Publish `server.json` to the official MCP Registry (D-16) | Installed in CI or run manually; not a project dependency `[CITED: modelcontextprotocol.io/registry/quickstart]` |
| `actions/setup-node` | GitHub Actions | Node setup + npm cache + registry auth for publish | Used in both `ci.yml` and `release.yml` `[CITED: docs.npmjs.com]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npm pack` + `npm i -g ./tarball` for smoke | `npm link` | `npm link` symlinks the working tree (doesn't validate `files`/published contents); `pack` validates the actual artifact a user installs. Use `pack`. |
| Trusted publishing (OIDC) | `NPM_TOKEN` secret (D-15 as written) | OIDC removes the long-lived secret AND auto-emits provenance; but it requires a one-time config in npmjs.com web UI tied to the exact repo+workflow. `NPM_TOKEN` is what D-15 literally says and works without UI setup. See Open Q2 — recommend OIDC, keep token as fallback. |
| `eslint@10` | `eslint@9` | v10 is current but newer than typescript-eslint's documented peer; v9 is the safer pin if peer conflicts appear. |
| Official MCP Registry (npm/stdio) | Smithery hosted deploy | Smithery now leans toward *remote/hosted* servers via Docker `smithery deploy` + `smithery.yaml`; the official registry is the right home for a local npm/stdio server. List on the official registry first; Smithery/mcp.so are secondary aggregators that can ingest from it. |

**Installation:**
```bash
# Lint toolchain (D-03)
npm install --save-dev eslint@10 @eslint/js typescript-eslint

# Coverage (already present in lockfile; ensure in devDependencies)
npm install --save-dev @vitest/coverage-v8

# ONLY if implementing the real MCP server (Open Q1):
npm install @modelcontextprotocol/sdk
```

**Version verification (run during execution before committing the stack):**
```bash
npm view eslint version              # → 10.4.1 (2026-06-11)
npm view typescript-eslint version   # → 8.61.0
npm view @eslint/js version          # → 10.0.1
npm view @modelcontextprotocol/sdk version  # → 1.29.0
npm view sessionmem version          # → E404 (name AVAILABLE, D-13 holds)
```

## Package Legitimacy Audit

> **slopcheck could not be run this session:** the sandbox classifier denied installing the `slopcheck` pip package (arbitrary-package supply-chain guard). Per the Package Legitimacy Gate graceful-degradation rule, every package below is tagged `[ASSUMED]` and the planner MUST gate each install behind a `checkpoint:human-verify` task (or rely on the fact that these are universally-known official packages). All names were nonetheless verified to exist on the **npm** registry via `npm view`, and all were discovered from **official documentation** (typescript-eslint.io, modelcontextprotocol.io), not from a search-engine guess.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `eslint` | npm | 12+ yrs | ~50M/wk | github.com/eslint/eslint | not run | Approved (official, registry-verified) `[ASSUMED]` |
| `typescript-eslint` | npm | 6+ yrs | ~20M/wk | github.com/typescript-eslint/typescript-eslint | not run | Approved (official) `[ASSUMED]` |
| `@eslint/js` | npm | 3+ yrs | ~40M/wk | github.com/eslint/eslint (monorepo) | not run | Approved (official) `[ASSUMED]` |
| `@vitest/coverage-v8` | npm | 3+ yrs | ~10M/wk | github.com/vitest-dev/vitest | not run | Approved (official; already in lockfile) `[ASSUMED]` |
| `@modelcontextprotocol/sdk` | npm | 1+ yr | high | github.com/modelcontextprotocol/typescript-sdk | not run | Approved IF used (official Anthropic SDK) `[ASSUMED]` |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck not run).
**Packages flagged as suspicious [SUS]:** none.
**Postinstall-script check (Node):** not run this session — planner should run `npm view <pkg> scripts.postinstall` for each before install; none of these official packages are expected to ship network/FS postinstall scripts, but verify.

## Architecture Patterns

### System Architecture Diagram (Phase 8 deliverables, data flow)

```
                         ┌─────────────────────────── DEVELOPER / MAINTAINER ───────────────────────────┐
                         │                                                                              │
   git push / PR ────────┼──────────────► .github/workflows/ci.yml  (NEW, D-01..D-04)                   │
                         │                   │ matrix: {ubuntu, macos, windows} × {node20, node22}      │
                         │                   ├─► npm ci                                                  │
                         │                   ├─► eslint .          (lint gate, D-03)                     │
                         │                   ├─► tsc --noEmit      (typecheck gate)                      │
                         │                   ├─► vitest run        (test gate, QLTY-01)                  │
                         │                   ├─► npm run build     (tsc + copy-migrations)               │
                         │                   └─► install-smoke (D-02):                                   │
                         │                         npm pack → install tarball globally →                 │
                         │                         sessionmem --version / ping →                         │
                         │                         sessionmem install (temp HOME) → assert config/hooks  │
                         │                                                                              │
   git tag v1.0.0 ───────┼──────────────► .github/workflows/release.yml (NEW, D-15)                      │
   & push tag            │                   ├─► build + test (reuse ci gates)                           │
                         │                   └─► npm publish (OIDC trusted publish ▸ provenance,         │
                         │                         or NPM_TOKEN fallback) ──────────► npmjs.com/sessionmem
                         │                                                                              │
   npm run benchmark ────┼──────────────► scripts/benchmark.mjs (NEW, D-12)                              │
                         │                   ├─ drives src/core retrieve + formatStartupInjection        │
                         │                   ├─ token-reduction (injected vs full-history baseline)      │
                         │                   ├─ relevance hit-rate over curated query fixtures           │
                         │                   └─► writes docs/benchmark.md (QLTY-04)                       │
                         └──────────────────────────────────────────────────────────────────────────────┘

   DISTRIBUTION METADATA (D-16, points at the npm artifact above):
     server.json (io.github.<user>/sessionmem) ──mcp-publisher publish──► registry.modelcontextprotocol.io
     .claude-plugin/marketplace.json + plugin.json + .mcp.json ──git push──► Claude Code plugin marketplace

   DOCS (QLTY-03):  README.md, docs/architecture.md, docs/troubleshooting.md, docs/migration.md
                    guarded by tests/integration/docs/*-docs.spec.ts (D-09)
```

### Recommended Project Structure (new/changed files)
```
/
├── README.md                     # NEW (D-05) — entry point, quickstart, links to docs/
├── LICENSE                       # NEW (D-14) — MIT
├── eslint.config.mjs             # NEW (D-03) — flat config
├── package.json                  # MODIFY (D-13/D-14) — private:false, 1.0.0, license, repository, files, scripts: lint/typecheck/benchmark
├── server.json                   # NEW (D-16) — MCP Registry metadata
├── .claude-plugin/
│   ├── marketplace.json          # NEW (D-16) — Claude Code marketplace catalog
│   └── plugin.json               # NEW (D-16) — plugin manifest
├── .mcp.json                     # NEW (D-16) — plugin's MCP server wiring (optional; can inline in plugin.json)
├── .gitignore                    # MODIFY — add dist/ (currently untracked-but-unignored; CONCERNS.md)
├── docs/
│   ├── architecture.md           # NEW (D-06)
│   ├── troubleshooting.md        # NEW (D-07)
│   ├── migration.md              # NEW (D-08)
│   └── benchmark.md              # NEW (D-12, generated)
├── scripts/
│   └── benchmark.mjs             # NEW (D-12) — npm run benchmark
├── tests/integration/docs/
│   ├── readme-docs.spec.ts       # NEW (D-09)
│   ├── architecture-docs.spec.ts # NEW (D-09)
│   ├── troubleshooting-docs.spec.ts # NEW (D-09)
│   └── migration-docs.spec.ts    # NEW (D-09)
└── .github/workflows/
    ├── ci.yml                    # NEW (D-01..D-04)
    └── release.yml               # NEW (D-15)
```

### Pattern 1: ESLint 10 flat config for strict TS ESM
**What:** Single `eslint.config.mjs` at repo root composing JS-recommended + typescript-eslint-recommended, with a relaxed override for test files.
**When to use:** This is the only supported ESLint config form in v10 (`.eslintrc` removed).
```javascript
// Source: typescript-eslint.io/getting-started (adapted for this repo's ESM + tests layout)
// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // tests use vitest globals + looser any in fixtures/mocks
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
```
> Note: `tseslint.configs.recommended` is *non-type-checked* (fast, no `parserOptions.project`). Prefer it for CI speed; only move to `recommendedTypeChecked` if the team wants type-aware rules (slower, needs `tsconfig` wiring). `[CITED: typescript-eslint.io/getting-started]`

### Pattern 2: CI matrix (D-01) — lint/typecheck/test/build
**What:** One workflow, two jobs (`checks` matrix + `install-smoke` matrix), running on push/PR.
```yaml
# Source: composed from GitHub Actions + npm docs; mirrors existing security.yml triggers
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  checks:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: npx eslint .            # D-03 lint gate
      - run: npx tsc --noEmit        # typecheck gate
      - run: npm test                # vitest run (D-04)
      - run: npm run build           # tsc + copy-migrations
```
> `better-sqlite3` is a native module — `npm ci` will compile it per-OS/per-Node. This is the main matrix risk (see Pitfall 2). Windows needs build tools; `setup-node` runners include them, but verify the install-smoke global install compiles cleanly on Windows.

### Pattern 3: Install-smoke job (D-02)
**What:** Validate the *packaged* artifact end-to-end as a user would, isolated from the repo.
```yaml
  install-smoke:
    needs: checks
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npm pack                      # → sessionmem-<ver>.tgz
      - run: npm i -g ./sessionmem-*.tgz    # global install of the real artifact
      - run: sessionmem --version           # binary resolves + runs
      # install against an isolated temp HOME so we assert real config writes:
      - shell: bash
        run: |
          export HOME="$(mktemp -d)"        # POSIX; Windows step uses a different temp-HOME trick
          sessionmem install                # detects adapter, writes ~/.sessionmem + adapter config
          test -f "$HOME/.sessionmem/config.json"   # assert config written
```
> **CONSTRAINT (stub server):** `sessionmem run` (the MCP server) only logs and exits — it is NOT a functioning stdio server (see Summary + CONCERNS.md). So D-02's "run the installed binary" must be limited to `--version` and `ping`/`install` (CLI paths that work), NOT a real server handshake. `commander` exposes `--version` (set from `package.json`, currently hard-coded `0.1.0` in `src/cli/index.ts:25` — must be bumped to match 1.0.0). On Windows, `export HOME` doesn't redirect `os.homedir()`; the smoke step must set `USERPROFILE` (Windows) / `HOME` (POSIX) appropriately, or use the CLI's `--db`/config override seam (`CliContextOverrides`) the install tests already use. See Pitfall 3.

### Pattern 4: Doc-coverage test (D-09) — mirror of existing specs
**What:** Each new doc gets a spec asserting existence + required tokens. This is a *drift guard*, not a prose judge (the existing specs say this explicitly).
```typescript
// Source: tests/integration/docs/privacy-docs.spec.ts (existing pattern, verbatim shape)
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DOC_PATH = join(process.cwd(), "docs", "architecture.md");

describe("architecture docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });
  it("covers the core subsystems", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const token of ["core engine", "adapter", "CLI", "SQLite", "retrieval", "injection"]) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });
});
```
> README spec lives at `tests/integration/docs/readme-docs.spec.ts` but reads `join(process.cwd(), "README.md")` (root, not `docs/`).

### Pattern 5: Reproducible benchmark script (D-12)
**What:** A Node ESM script under `scripts/` that imports the real core functions, runs measurements, and writes `docs/benchmark.md`. It uses the SAME APIs the quality harness uses: `formatStartupInjection()` + `countTokens()` from `src/core/injection`, and `retrieveMemories()` from `src/core/retrieve`.
```javascript
// Source: shape from scripts/copy-migrations.mjs (ESM script convention) +
//         tests/quality/injection/injection-quality-harness.spec.ts (token measurement)
// scripts/benchmark.mjs runs against built dist/ OR ts via tsx; planner picks.
// Token reduction (D-10a): baseline = countTokens(full concatenated history);
//   injected = countTokens(formatStartupInjection(retrieved topK)); report (1 - injected/baseline).
// Relevance (D-11): curated [{query, expectedMemoryIds}] fixtures → run retrieveMemories →
//   compute hit@k / precision / recall → aggregate.
```
> **Reuse, don't re-implement:** the harness already proves `countTokens` and `formatStartupInjection` produce deterministic, budget-capped output. The benchmark reuses these directly. `deterministicEmbed` (offline, hash-based) means the benchmark runs with no network and is fully reproducible. `[VERIFIED: codebase grep — src/core/injection/tokenBudget.ts, formatStartupInjection.ts, src/core/embed/deterministicEmbed.ts]`

### Pattern 6: npm trusted publishing (OIDC) — recommended over raw NPM_TOKEN
**What:** Tag-triggered publish with no long-lived secret; npm auto-attaches provenance.
```yaml
# Source: docs.npmjs.com/trusted-publishers + github.blog OIDC GA changelog
name: Release
on:
  push: { tags: ["v*"] }
permissions:
  contents: read
  id-token: write          # REQUIRED for OIDC trusted publishing + provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with: { node-version: 22, registry-url: "https://registry.npmjs.org" }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm publish --access public   # OIDC auto-detected; no token, provenance auto-emitted
```
> Trusted publishing needs a **one-time setup in the npmjs.com web UI** (Package → Settings → Trusted Publisher → add GitHub repo + workflow filename). It only works on cloud-hosted runners and for public repos (provenance requires public). If that UI setup isn't acceptable, D-15's literal `NPM_TOKEN` path works: add `env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }` to the publish step and (optionally) `npm publish --provenance`. `[CITED: docs.npmjs.com/trusted-publishers; github.blog 2025-07-31 OIDC GA]` See Open Q2.

### Anti-Patterns to Avoid
- **Smoke-testing with `npm link`** instead of `npm pack` — link bypasses the `files` allow-list, so a broken `files`/missing `dist` ships to users undetected.
- **Hard-coding the version in `src/cli/index.ts`** (`program.version("0.1.0")`) — it will drift from `package.json`. Read it from `package.json` or bump both; the install-smoke `--version` check will catch the mismatch only if you assert the actual number.
- **Type-checked ESLint preset in CI by default** — `recommendedTypeChecked` needs `parserOptions.project` and is materially slower across a 6-cell matrix. Use plain `recommended` unless type-aware rules are explicitly wanted.
- **Committing `dist/`** — `dist/` is currently untracked but NOT in `.gitignore` (CONCERNS.md). Add it; the package ships `dist/` via `files`+`prepublishOnly`/`prepack` build, not via git.
- **Advertising a non-functional MCP server** in registry/plugin metadata — submitting `server.json` for a server whose `run` only logs is misleading and will fail any reviewer/user smoke. Resolve Open Q1 first.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Linting TS | Custom AST checks / regex lint | `eslint` + `typescript-eslint` flat config | Decades of edge cases; official preset |
| MCP stdio protocol | Hand-rolled JSON-RPC over stdin/stdout | `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`) | Protocol versioning, framing, lifecycle, capability negotiation — the SDK is the only sane path (the stub's own comment says "Will hook up to @modelcontextprotocol/sdk here") |
| MCP Registry submission | Manual POST to registry API + JWT juggling | `mcp-publisher` CLI (`init`/`login`/`publish`) | Handles GitHub-OIDC/device auth, namespace verification, schema validation |
| npm provenance / supply-chain attestation | Custom signing | npm trusted publishing (OIDC) | Built-in, free, automatic when `id-token: write` + trusted-publisher configured |
| Cross-OS native build for `better-sqlite3` | Bundling prebuilds yourself | Let `npm ci` compile per-runner in the matrix | Matrix already exercises every OS/Node combo; that IS the validation |
| Token counting for benchmark | Custom tokenizer | existing `countTokens` (`js-tiktoken`-backed, `src/core/injection/tokenBudget.ts`) | Already used by the shipped injection budget; benchmark must match production counting |

**Key insight:** Almost every "build a thing" in this phase already has an official tool or an existing in-repo function. The phase's real work is *wiring and authoring*, not invention — except for the one genuine gap (the real MCP server), which is exactly the thing the stub defers.

## Runtime State Inventory

> Phase 8 is mostly additive (CI/docs/publish), but the npm publish + version bump + distribution submission DO create runtime/external state. Included for the publish/distribution surface.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 8 adds no schema/migration and no datastore keys. The DB schema (`001`–`005`) is untouched. (verified: no migration files in scope; `docs/migration.md` only *documents* the existing system) | None |
| Live service config | **npm registry**: publishing `sessionmem@1.0.0` claims the name permanently and is effectively irreversible (npm unpublish is heavily restricted after 72h). **MCP Registry**: `server.json` published under `io.github.<user>/sessionmem` namespace, tied to GitHub auth. **Claude Code marketplace**: listing lives in a git repo users `/plugin marketplace add`. | Verify name (`npm view sessionmem` → E404, available); choose namespace owner; one-time trusted-publisher UI config |
| OS-registered state | None at maintainer level. (Note: `sessionmem install` registers MCP config in host files like `~/.claude.json` on *end-user* machines — that's user-side, exercised by the smoke test, not maintainer state.) | None for the maintainer; smoke test must use an isolated temp HOME so it doesn't mutate the runner's real `~/.claude.json` |
| Secrets/env vars | **`NPM_TOKEN`** GitHub secret (only if NOT using OIDC, D-15 literal). **`id-token: write`** permission (if OIDC). MCP Registry uses ephemeral device/OIDC auth — no stored secret. No `.env` exists today. | Create the secret OR configure trusted publisher; never commit either |
| Build artifacts | **`dist/`** is currently present in the working tree, untracked, and NOT gitignored (CONCERNS.md "Build Configuration"). `version` is hard-coded `0.1.0` in BOTH `package.json` and `src/cli/index.ts:25`. `bin` points at `./dist/cli/index.js`. `files` field is absent → npm would publish the whole repo unless `files` is set. | Add `dist/` to `.gitignore`; add `files: ["dist"]` + `prepack`/`prepublishOnly` build; bump version in both places (or source it from package.json) |

**Nothing found requiring data migration:** Phase 8 ships no DB changes — verified by absence of new files under `src/core/schema/migrations/` in scope and by D-08 being documentation-only.

## Common Pitfalls

### Pitfall 1: The MCP server is a stub — distribution + smoke depend on it
**What goes wrong:** You ship `server.json` and a plugin manifest advertising an MCP server, but `sessionmem run` only prints a log line and exits — there's no stdio handshake, no tools exposed. Users install it, the host shows "MCP server failed to respond," and the registry/plugin listing is dead on arrival.
**Why it happens:** `src/adapters/generic.ts::startMcpServer()` is a documented stub; `@modelcontextprotocol/sdk` was never wired (CONCERNS.md, ARCHITECTURE.md, INTEGRATIONS.md all flag it).
**How to avoid:** Resolve Open Q1 explicitly with the user before planning the D-02 binary-run and D-16 submission. Either (a) implement the real server with `@modelcontextprotocol/sdk` (dispatch the existing `MemoryCoreService` methods as MCP tools), or (b) narrow D-02 to CLI-only and defer the MCP-server-advertising parts of D-16.
**Warning signs:** Any plan task that says "run `sessionmem run` and assert MCP response," or any `server.json` task, without a preceding "implement stdio server" task.

### Pitfall 2: `better-sqlite3` native compile across the OS/Node matrix
**What goes wrong:** Matrix cells fail at `npm ci` because the native module won't compile (missing build tools, Node ABI mismatch on Node 20 vs 22, Windows MSVC issues).
**Why it happens:** `better-sqlite3@^12` compiles native bindings per Node ABI/OS. Node 24 is the *local* dev version (verified `node --version` → v24.16.0) but CI targets 20/22 — prebuilds must exist for those.
**How to avoid:** Keep `fail-fast: false` so one cell's failure surfaces all problems. Rely on `setup-node`'s bundled toolchain. If a cell fails to find a prebuild and lacks a compiler, that's a real portability bug to fix, not to mask.
**Warning signs:** `node-gyp` errors, `Could not locate the bindings file`, ABI version mismatch messages.

### Pitfall 3: Smoke test mutating the runner's real home
**What goes wrong:** `sessionmem install` writes to `~/.sessionmem/` and `~/.claude.json` (or detected adapter config). In CI that pollutes the runner; worse, on Windows `export HOME=...` does NOT change what Node's `os.homedir()` returns (it reads `USERPROFILE`), so isolation silently fails.
**Why it happens:** `os.homedir()` platform differences; `createCliContext` resolves paths from home.
**How to avoid:** Use the install command's existing override seam — the install tests pass `{ dbPath, configPath }` via `CliContextOverrides`. For a true end-to-end CLI smoke (no overrides), set `HOME` (POSIX) and `USERPROFILE`+`HOMEPATH` (Windows) to a `mktemp` dir, OR detect a non-default adapter. Assert `config.json` exists in the temp home, then clean up.
**Warning signs:** Green on Linux/macOS, red or polluting on Windows; smoke writing to a real `~/.claude.json`.

### Pitfall 4: `private: true` and missing `files` blocking/over-broadening publish
**What goes wrong:** `npm publish` refuses while `private:true` is set; once removed, with no `files` field npm publishes the ENTIRE repo (src, tests, `.planning/`, node_modules-adjacent junk).
**Why it happens:** Current `package.json` has `private:true`, no `files`, no `publishConfig`, no `repository`/`author`/`license`.
**How to avoid:** D-14 covers this — set `private:false`, `files:["dist"]` (plus `README.md`,`LICENSE` which npm includes by default), `publishConfig:{access:"public"}`, `repository`, `author`, `license:"MIT"`. Run `npm pack --dry-run` and inspect the file list before publishing.
**Warning signs:** Tarball >> expected size; `.planning/` or `tests/` appearing in `npm pack --dry-run` output.

### Pitfall 5: Version drift between `package.json` and CLI
**What goes wrong:** `--version` prints `0.1.0` even after bumping `package.json` to `1.0.0`, because `src/cli/index.ts:25` hard-codes `.version("0.1.0")`. The install-smoke `--version` check passes against the wrong number or the published binary lies about its version.
**How to avoid:** Read version from `package.json` (`createRequire`/JSON import) in `index.ts`, or bump both and assert the literal `1.0.0` in the smoke test.

## Code Examples

### Detecting npm name availability (D-13)
```bash
# Source: npm CLI. E404 == available.
npm view sessionmem version
# → npm error code E404 ... 'sessionmem@*' could not be found  ⇒ AVAILABLE (verified 2026-06-11)
```

### Minimal MCP server (only if Open Q1 → implement)
```typescript
// Source: modelcontextprotocol.io TypeScript SDK pattern (shape; verify exact API at impl time)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// register tools that delegate to the existing MemoryCoreService (src/core/api/memoryCoreService.ts)
// then: await server.connect(new StdioServerTransport());
```
> The exact import paths/API surface of `@modelcontextprotocol/sdk@1.29.0` must be confirmed via the SDK README/Context7 at implementation time — do not trust this shape blindly. `[ASSUMED — SDK API not fetched this session]`

### server.json for the official MCP Registry (D-16)
```json
// Source: modelcontextprotocol.io/registry/quickstart (verbatim schema, adapted)
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.<owner>/sessionmem",
  "description": "Cross-session, cross-platform memory for coding agents.",
  "repository": { "url": "https://github.com/<owner>/sessionmem", "source": "github" },
  "version": "1.0.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "sessionmem",
      "version": "1.0.0",
      "transport": { "type": "stdio" }
    }
  ]
}
```
> Requires `"mcpName": "io.github.<owner>/sessionmem"` added to `package.json`, and the value MUST equal `server.json`'s `name`. Publish to npm first, then `mcp-publisher login github` + `mcp-publisher publish`. `[CITED: modelcontextprotocol.io/registry/quickstart]`

### Claude Code marketplace + plugin manifest (D-16)
```json
// Source: code.claude.com/docs/en/plugin-marketplaces  →  .claude-plugin/marketplace.json
{
  "name": "sessionmem",
  "owner": { "name": "<owner>" },
  "plugins": [
    { "name": "sessionmem", "source": "./", "description": "Cross-session agent memory" }
  ]
}
```
```json
// Source: code.claude.com/docs/en/plugins-reference  →  .claude-plugin/plugin.json
{ "name": "sessionmem", "version": "1.0.0", "description": "Cross-session agent memory" }
```
```json
// Source: plugins-reference  →  .mcp.json (or inline "mcpServers" in plugin.json)
{ "mcpServers": { "sessionmem": { "command": "sessionmem", "args": ["run"] } } }
```
> `name` is the only required field in `plugin.json`; `marketplace.json` requires `name`, `owner`, `plugins[]`, each plugin needs `name`+`source`. This mirrors the block already in `src/cli/commands/install.ts::MANUAL_CONFIG_BLOCK`. `[CITED: code.claude.com/docs/en/plugins-reference & /plugin-marketplaces]`

## Test Coverage Gap Analysis (QLTY-01)

**Current state (verified by file count):** 52 spec files — 21 unit, 30 integration, 1 quality. Strong coverage exists for: retrieval ranking/scoring/decay, injection format + token budget, redaction rules + write-paths + leakage, retention/prune, CLI commands (install/uninstall/search/list/show/forget/export/import/stats/config/team/sync/redact-scan/retention), adapter factory/installer/fallback-tools/ping, summarization retry/fallback, cloud opt-in/local-only policy, schema, and the injection quality harness.

**Concrete, meaningful gaps to consider (not coverage padding):**
| Gap | Evidence | Suggested closure |
|-----|----------|-------------------|
| **Real MCP server behavior** | `startMcpServer` is a stub; `run-command.spec.ts` only asserts it "logs without throwing" | If Open Q1 → implement, add a stdio-server integration test (spawn `run`, send an MCP `initialize`, assert response). If not, document the gap. |
| **IDE-adapter `install()` paths** | `claudeCode.ts` install is unit-coverable but global adapters (codex/qcoder/antigravity) + IDE (cursor/cline/windsurf) `install()` aren't individually exercised | Add adapter-level install tests for at least one IDE + one global adapter (parity per Risk #1 "adapter parity drift") |
| **Generic adapter path (PLAT-08)** | `generic.ts` `call()` returns an error envelope; no test for the documented generic-host install path | Add a smoke for the generic adapter route |
| **Export→import round-trip losslessness (CLI-05)** | `export-import.spec.ts` exists; verify it asserts byte/field-level losslessness incl. team provenance (author/timestamp, TEAM-02) | Audit the existing spec; extend if provenance fields aren't round-tripped |
| **End-to-end install-smoke** | No test packs+installs the real artifact | This is exactly D-02's install-smoke job (CI-level, not a vitest spec) |

> The planner should treat "close meaningful gaps" as: (1) the MCP-server test IF implemented, (2) adapter install parity, (3) generic-adapter path. Avoid chasing a coverage % — there's no coverage gate configured today (no `vitest.config` with thresholds), and CONTEXT explicitly says don't pad.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.*` legacy config | flat `eslint.config.{js,mjs}` only | ESLint v9 (flat default), v10 (legacy removed, Feb 2026) | Must author flat config; no `.eslintrc` fallback `[CITED: pkgpulse/typescript-eslint]` |
| `NPM_TOKEN` long-lived publish secret | npm **trusted publishing** via GitHub OIDC + automatic provenance | GA 2025-07-31 | Remove the secret; `id-token: write` + one-time UI config; free provenance `[CITED: github.blog]` |
| Ad-hoc MCP server lists / README PRs | Official **MCP Registry** (`registry.modelcontextprotocol.io`) with `server.json` + `mcp-publisher` | Preview, growing through 2026 (9.6k+ servers as of May 2026) | Canonical discovery; aggregators (Smithery, mcp.so, GitHub MCP Registry) ingest from it `[CITED: modelcontextprotocol.io]` |
| Manual MCP install instructions | Claude Code **plugin marketplaces** (`.claude-plugin/marketplace.json`) | 2025-2026 | One-command `/plugin marketplace add` + install `[CITED: code.claude.com]` |

**Deprecated/outdated:**
- `.eslintrc` / `eslint --ext` flags: gone in ESLint 10.
- `--provenance` flag when using trusted publishing: now implicit/unnecessary.
- Smithery as a "submit your stdio server" target: Smithery has shifted toward *hosted/remote* servers (Docker `smithery deploy` + `smithery.yaml`); for a local npm/stdio server the official MCP Registry is the primary target, with Smithery/mcp.so as secondary aggregators.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 8 should advertise a *working* MCP server; whether to implement the real stdio server in this phase is unresolved and needs the user | Summary, Open Q1 | HIGH — if not resolved, D-02 binary-run and D-16 submission ship a dead server; or scope balloons unexpectedly |
| A2 | `eslint@10.4.1` + `typescript-eslint@8.61.0` are peer-compatible | Standard Stack | LOW — fallback to `eslint@9` is trivial; caught immediately by `npm run lint` |
| A3 | `@modelcontextprotocol/sdk@1.29.0` API shape (`McpServer`/`StdioServerTransport`) as sketched | Code Examples | MEDIUM — only matters if Q1→implement; verify SDK README/Context7 at impl time |
| A4 | npm trusted-publishing UI setup is acceptable to the maintainer (else use `NPM_TOKEN` per D-15 literal) | Pattern 6, Open Q2 | LOW — both paths documented; D-15 literally specifies the token path |
| A5 | Distribution targets remain official MCP Registry + Claude Code marketplace (+ optional mcp.so/Smithery); these are the active hubs as of 2026-06 | D-16 research | MEDIUM — registry is in "preview" and could change; verify `mcp-publisher` + schema URL at execution time |
| A6 | Privacy/security doc requirement (QLTY-03) is already satisfied by existing `docs/privacy-and-retention.md` + `cloud-summarization.md`; only README/architecture/troubleshooting/migration are NEW | Docs structure | LOW — confirmed by D-05..D-08 listing exactly those four new docs |

## Open Questions

1. **Does Phase 8 implement the real stdio MCP server, or is launch CLI-first with the MCP server deferred?**
   - What we know: The core engine, CLI, and adapters are complete and tested; only the protocol server (`startMcpServer`) is a stub with no SDK wired. D-02 says "run the installed binary" and D-16 says submit MCP-server distribution artifacts — both implicitly assume a working server.
   - What's unclear: Whether the user wants the launch to include a functioning MCP server (correct for an "MCP-compatible host" product per PLAT-01..08) or to launch the CLI and defer the server.
   - Recommendation: **Surface to the user before planning.** If yes → add an "implement stdio MCP server with `@modelcontextprotocol/sdk`" plan as a prerequisite for D-02's binary-run and D-16. If no → narrow D-02 to `--version`/CLI smoke and split D-16 so only non-server-claiming listings ship (or defer D-16). This is the single highest-leverage planning decision.

2. **Trusted publishing (OIDC) or `NPM_TOKEN` (D-15 literal) for `release.yml`?**
   - What we know: OIDC is the current best practice (no stored secret, free provenance) but needs one-time npmjs.com UI config tied to repo+workflow and only works on public repos/cloud runners. D-15 text says `NPM_TOKEN`.
   - Recommendation: Default to OIDC; keep `NPM_TOKEN` as a documented fallback. Confirm the maintainer can do the UI setup; if not, implement D-15 as written.

3. **Which GitHub namespace owns `io.github.<owner>/sessionmem` and the marketplace?**
   - What we know: MCP Registry namespace is tied to the publishing GitHub account/org; `mcpName` in `package.json` must match.
   - Recommendation: Confirm the GitHub owner/org during planning so `server.json`, `mcpName`, `repository`, and `marketplace.json` all use a consistent identity.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All build/test | ✓ (local) | v24.16.0 (CI targets 20/22 per D-01) | — |
| npm | install/pack/publish | ✓ | 11.13.0 | — |
| C/C++ toolchain (native `better-sqlite3`) | `npm ci` per matrix cell | ✓ on GitHub runners | bundled | prebuilt binaries; else fix portability |
| `mcp-publisher` CLI | D-16 registry publish | ✗ (not installed) | — | Install in CI/manually from GitHub release or `brew install mcp-publisher` at execution time |
| `gh` CLI | (would help registry/marketplace ops) | ✗ (not on PATH in this env) | — | Not required for the deliverables; use web UI / `mcp-publisher` |
| npm registry name `sessionmem` | D-13 publish | ✓ AVAILABLE | E404 (unclaimed, verified 2026-06-11) | scoped `@<owner>/sessionmem` fallback per D-13 |
| Network (registry/plugin submission) | D-16 | host-dependent | — | Submission is a manual/CI step at release time, not during local dev |

**Missing dependencies with no fallback:** none block planning. `mcp-publisher` is installed on demand at the publish step.
**Missing dependencies with fallback:** `mcp-publisher` (install at execution); scoped npm name (if `sessionmem` somehow taken by publish time).

## Validation Architecture

> `nyquist_validation` is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.8 (`[VERIFIED: package.json devDependencies + npm view]`) |
| Config file | none — vitest runs with defaults; no `vitest.config.*` present (verified). No coverage thresholds configured. |
| Quick run command | `npx vitest run <path> --reporter=dot` |
| Full suite command | `npm test` (= `vitest run --reporter=dot`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QLTY-01 | Core flows + adapters covered | unit+integration | `npm test` | ✅ (52 specs) + ❌ Wave 0 gaps (adapter install parity, generic path, MCP server if implemented) |
| QLTY-02 | Lint passes | lint | `npx eslint .` | ❌ Wave 0 (no eslint.config yet) |
| QLTY-02 | Typecheck passes | typecheck | `npx tsc --noEmit` | ✅ (tsconfig strict exists) |
| QLTY-02 | Tests pass in CI | integration | `npm test` | ✅ |
| QLTY-02 | Install-smoke per OS | smoke (CI) | `npm pack && npm i -g ./*.tgz && sessionmem --version && sessionmem install` | ❌ Wave 0 (CI job) |
| QLTY-03 | README exists w/ sections | integration | `npx vitest run tests/integration/docs/readme-docs.spec.ts -x` | ❌ Wave 0 |
| QLTY-03 | architecture/troubleshooting/migration docs exist w/ sections | integration | `npx vitest run tests/integration/docs/ -x` | ❌ Wave 0 (3 new specs) |
| QLTY-04 | Benchmark report generated reproducibly | script + manual review | `npm run benchmark` then inspect `docs/benchmark.md` | ❌ Wave 0 |
| QLTY-04 | Benchmark report exists w/ required sections | integration | `npx vitest run tests/integration/docs/benchmark-docs.spec.ts -x` (optional, mirror D-09) | ❌ Wave 0 (optional) |
| QLTY-05 | `package.json` publishable | unit | `npm pack --dry-run` (assert no private flag, files list correct) | ❌ Wave 0 |
| QLTY-05 | npm publish works | manual/CI | tag push → `release.yml` (validated only at real release) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched-spec> --reporter=dot` + `npx eslint <touched-files>` once eslint exists.
- **Per wave merge:** `npm test` + `npx eslint .` + `npx tsc --noEmit`.
- **Phase gate:** Full suite green + lint clean + `npm pack --dry-run` reviewed before `/gsd:verify-work`. Install-smoke validated via CI (the new `ci.yml` IS the validation harness for D-02).

### Wave 0 Gaps
- [ ] `eslint.config.mjs` — required before any lint step can run (D-03)
- [ ] `tests/integration/docs/readme-docs.spec.ts` — covers QLTY-03 (README)
- [ ] `tests/integration/docs/architecture-docs.spec.ts` — covers QLTY-03 (D-06)
- [ ] `tests/integration/docs/troubleshooting-docs.spec.ts` — covers QLTY-03 (D-07)
- [ ] `tests/integration/docs/migration-docs.spec.ts` — covers QLTY-03 (D-08)
- [ ] `scripts/benchmark.mjs` + `npm run benchmark` script — covers QLTY-04 (D-12)
- [ ] `.github/workflows/ci.yml` — covers QLTY-02 (the validation harness itself)
- [ ] (conditional, Open Q1) MCP stdio server integration test — covers QLTY-01 gap
- [ ] Adapter `install()` parity tests (≥1 IDE + ≥1 global) — covers QLTY-01 gap
- [ ] `@vitest/coverage-v8` in devDependencies if any coverage reporting is wanted (optional; no threshold gate today)

## Security Domain

> `security_enforcement` not explicitly set to false in config.json → treated as enabled. Phase 8 is release engineering; the security surface is supply-chain + secret handling, not app input validation (that was Phase 6).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (publish identity) | GitHub OIDC for npm trusted publishing + MCP Registry namespace auth; no shared long-lived tokens |
| V3 Session Management | no | No sessions introduced |
| V4 Access Control | yes (who can publish) | Restrict `release.yml` to tag pushes; `id-token: write` scoped to the publish job only; trusted-publisher filter pins repo+workflow |
| V5 Input Validation | minimal | Docs/CI are static; `mcp-publisher`/npm validate their own schemas |
| V6 Cryptography | yes (provenance) | npm provenance attestations via Sigstore (automatic with OIDC) — never hand-roll signing |
| V10/V14 Supply Chain | yes (PRIMARY) | `npm ci` (lockfile-pinned), existing Gitleaks/Trivy/Semgrep `security.yml` stays (D-04), provenance on publish, `files` allow-list to avoid leaking repo contents |

### Known Threat Patterns for release-engineering / npm publish

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Leaked `NPM_TOKEN` → malicious publish | Spoofing/Elevation | Prefer OIDC trusted publishing (no stored token); if token, scope to a publish-only granular token in a protected environment |
| Publishing repo secrets / over-broad tarball | Information Disclosure | `files:["dist"]`; `npm pack --dry-run` review; Gitleaks gate already present |
| Slopsquatted/typosquatted dep added during phase | Tampering | All new deps are official + registry-verified; planner gates installs (slopcheck unavailable this session) |
| Compromised CI step exfiltrating OIDC token | Elevation | `permissions: id-token: write` only on the publish job; pin action versions; minimal job steps |
| Advertising a non-functional MCP server (trust erosion) | Repudiation (reputational) | Resolve Open Q1 — don't list a dead server in registry/marketplace |
| Malicious migrations from invocation dir | Tampering | Already mitigated Phase 5 (Decision #15: migrationsDir resolved package-relative); unchanged here |

## Sources

### Primary (HIGH confidence)
- `modelcontextprotocol.io/registry/quickstart` — full `server.json`, `mcpName`, `mcp-publisher init/login github/publish` flow, npm-first requirement (fetched, verbatim)
- `modelcontextprotocol.io/registry/about` — registry purpose, npm relationship, namespace auth, preview status
- `code.claude.com/docs/en/plugins-reference` — `plugin.json` (`name` only required), `.mcp.json`/`mcpServers` format, `CLAUDE_PLUGIN_ROOT`, directory layout
- `code.claude.com/docs/en/plugin-marketplaces` — `marketplace.json` required fields (`name`,`owner`,`plugins[]`), `source` types, example
- `typescript-eslint.io/getting-started` — flat config, install set, recommended preset, current versions
- `docs.npmjs.com/trusted-publishers` + `github.blog/changelog/2025-07-31 OIDC GA` — OIDC publish, automatic provenance, `id-token: write`
- Codebase (grep/read, VERIFIED): `package.json`, `tsconfig.json`, `.github/workflows/security.yml`, `src/cli/index.ts`, `src/cli/commands/{install,run}.ts`, `src/adapters/generic.ts` (stub), `tests/integration/docs/{privacy,team}-docs.spec.ts`, `tests/integration/retrieve/retrieve-ranked.spec.ts`, `tests/quality/injection/injection-quality-harness.spec.ts`, `scripts/copy-migrations.mjs`, `.planning/codebase/{CONCERNS,ARCHITECTURE,INTEGRATIONS}.md`
- `npm view` (VERIFIED 2026-06-11): `sessionmem` E404 (available), `eslint@10.4.1`, `typescript-eslint@8.61.0`, `@eslint/js@10.0.1`, `@modelcontextprotocol/sdk@1.29.0`, `@vitest/coverage-v8@4.1.8`

### Secondary (MEDIUM confidence)
- `smithery.ai/docs/build/publish` (via WebSearch summary) — Smithery shifted toward hosted/remote + Docker `smithery deploy`; secondary aggregator
- `pkgpulse.com` ESLint 10 migration, `dev.to` 2026 TS setup — corroborate flat-config-only + v10 timeline

### Tertiary (LOW confidence — flagged)
- `@modelcontextprotocol/sdk` exact API shape (`McpServer`/`StdioServerTransport`) — not fetched this session; verify at impl time (A3)
- Exact `mcp-publisher` GitHub-Actions/`github-oidc` CI auth recipe — quickstart covers device-login; CI automation page (`modelcontextprotocol.io/registry/github-actions`) referenced but not fetched; verify at execution

## Metadata

**Confidence breakdown:**
- CI / install-smoke design: HIGH — verified against existing `security.yml`, codebase install/run code, and official Actions/npm docs; constrained honestly by the stub-server finding.
- npm publish (D-13/D-14/D-15): HIGH — name availability verified, OIDC/provenance flow from official npm docs, `package.json` gaps enumerated from the actual file.
- Docs + coverage tests (D-05..D-09): HIGH — pattern lifted verbatim from existing specs; privacy/security already covered.
- Benchmark (D-10/D-11/D-12): MEDIUM — reuses verified in-repo functions, but token-reduction framing is judgment-driven (D-10 explicitly).
- Distribution (D-16): HIGH on formats (registry quickstart + plugin docs fetched verbatim); MEDIUM on the cross-cutting blocker (server is a stub).
- Test-coverage gaps (QLTY-01): MEDIUM — grounded in a real file-by-file survey, but "meaningful" is a judgment call per CONTEXT.
- Lint stack peer-compat (A2): MEDIUM — versions verified individually; the exact pair not lint-run this session.

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 for stable areas (npm/CI/docs); ~2026-06-25 for MCP Registry specifics (explicitly in "preview", schema-dated `2025-12-11`, may change).
