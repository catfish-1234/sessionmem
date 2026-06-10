# Codebase Concerns

**Analysis Date:** 2026-06-10

## Tech Debt

**MCP Server Not Implemented:**
- Issue: `src/adapters/generic.ts` has stub `startMcpServer()` that only logs a message
- Files: `src/adapters/generic.ts`, `src/adapters/ide/*.ts`, `src/adapters/global/*.ts`
- Impact: Adapters cannot actually communicate with host IDEs/tools - MCP protocol not functional
- Fix approach: Implement stdio-based MCP server using @modelcontextprotocol/sdk

**Build Configuration Now Present (Resolved):**
- Status: `tsconfig.json` exists at project root with `module: NodeNext`, `target: ES2022`, `strict: true`, `outDir: dist`, `rootDir: src`
- Files: `tsconfig.json`
- Note: `dist/` is present in working tree as an untracked build artifact (per git status) but `dist/` is not listed in `.gitignore` — only `node_modules/` and `*.log` are ignored
- Impact: Compiled output (`dist/`) risks being accidentally committed since it is not gitignored
- Fix approach: Add `dist/` to `.gitignore` to prevent committing build artifacts

**Cloud Summarizer Incomplete:**
- Issue: `src/core/summarize/cloudSummarizer.ts` imported but implementation not verified
- Files: `src/core/summarize/cloudSummarizer.ts`
- Impact: Cloud summarization fallback will fail when enabled with allowCloudSummarization=true
- Fix approach: Complete implementation with Anthropic API integration

**No Environment Configuration:**
- Issue: No dotenv or .env file handling - config passed in code
- Files: `src/adapters/factory.ts`, service configs
- Impact: No standard way to configure API keys, database paths, etc.
- Fix approach: Add dotenv support or environment variable handling

**No CI Test/Lint/Build Workflow:**
- Issue: `.github/workflows/` only contains `security.yml` (Semgrep, Gitleaks, Trivy scans). There is no workflow that runs `tsc`, lint, or the test suite on push/PR.
- Files: `.github/workflows/security.yml` (only workflow present)
- Impact: Type errors, lint violations, and test failures can be merged to `main` without automated detection. The newly added `tsconfig.json` (`strict: true`) is not enforced in CI.
- Fix approach: Add a `ci.yml` workflow that runs `npm ci`, `tsc --noEmit`, lint, and `npm test` on push/PR to `main`

**Skills Lockfile Pulls from Third-Party GitHub Repos:**
- Issue: `skills-lock.json` pins multiple skills (e.g., `cavecrew`, `caveman`) sourced from `JuliusBrussee/caveman` via `sourceType: github` with computed hashes
- Files: `skills-lock.json`
- Impact: Project tooling/agent behavior depends on an external, third-party-maintained GitHub repo. If that repo is deleted, renamed, or compromised, skill installs/updates could fail or pull unexpected content (hash pinning mitigates content drift but not availability)
- Fix approach: Periodically verify hashes still match upstream; consider vendoring critical skills or mirroring the source repo

## Known Bugs

**No Critical Bugs Detected:**
- No TODO/FIXME/HACK comments found in source

## Security Considerations

**Hardcoded Secrets Risk:**
- Risk: API keys could be passed in config objects or environment variables not securely stored
- Files: `src/core/summarize/cloudSummarizer.ts`, `src/core/api/contracts.ts`
- Current mitigation: Pre-commit `gitleaks` hook (`.pre-commit-config.yaml`, gitleaks v8.18.4) scans staged changes for secrets; CI `security.yml` also runs `gitleaks-action@v3` on push/PR to `main`
- Recommendations: Use secure secret management, document required env vars; ensure pre-commit hooks are actually installed locally (`pre-commit install`) since the hook only protects committers who've run setup

**File System Log Location:**
- Risk: Log directory created in home directory without error handling
- Files: `src/cli/commands/run.ts`
- Current mitigation: try-catch around file write
- Recommendations: Add proper error handling for path issues

**CI Security Scans Configured but No Test Gate:**
- Risk: `.github/workflows/security.yml` runs Semgrep (SAST), Gitleaks (secret scanning), and Trivy (filesystem vuln scan with `exit-code: 1` on HIGH/CRITICAL) on every push/PR to `main` — this is solid coverage for security, but there is no equivalent gate for correctness (tests/types)
- Files: `.github/workflows/security.yml`
- Current mitigation: Security scanning is in place; Trivy fails the build on HIGH/CRITICAL findings
- Recommendations: Pair the security workflow with a CI workflow for build/test/typecheck so both correctness and security are gated on `main`

**Dependabot Covers npm and GitHub Actions:**
- Status: `.github/dependabot.yml` configures weekly updates for both `npm` (root directory) and `github-actions` ecosystems
- Files: `.github/dependabot.yml`
- Current mitigation: Automated dependency update PRs reduce risk of stale/vulnerable dependencies (addresses part of the "Dependencies at Risk" concern below for transitive deps)
- Recommendations: Ensure Dependabot PRs are reviewed/merged regularly; without a CI test workflow, these PRs can't be auto-validated before merge

## Performance Bottlenecks

**Full Table Scan Retrieval:**
- Problem: `retrieveMemories` loads ALL memories then filters in JavaScript
- Files: `src/core/retrieve/retrieveMemories.ts`, `src/core/storage/memorySearchRepo.ts`
- Cause: No vector similarity search at DB level, all candidates loaded first
- Improvement path: Implement SQL-based similarity search or integrate with a vector database

**No Query Result Caching:**
- Problem: Every retrieval hits SQLite database
- Files: All service methods
- Cause: No caching layer implemented
- Improvement path: Add in-memory cache for frequently accessed memories

**Token Counting Per Iteration:**
- Problem: `tokenBudget.ts` re-encodes tokens multiple times during trimming
- Files: `src/core/injection/tokenBudget.ts`, `src/core/injection/formatStartupInjection.ts`
- Cause: Each trim iteration calls `countTokens` on same content
- Improvement path: Pre-compute token counts once

## Fragile Areas

**GenericMCPAdapter.call() Throws:**
- Files: `src/adapters/generic.ts`
- Why fragile: Any adapter call fails with "Method not implemented"
- Safe modification: Implement actual MCP protocol before any adapter work
- Test coverage: N/A - stub implementation

**SessionLifecycleService Retry Logic:**
- Files: `src/core/api/sessionLifecycleService.ts`
- Why fragile: Retry count hardcoded, fallbacks may mask real issues
- Safe modification: Make retry counts configurable, add more specific error handling

## Scaling Limits

**SQLite Single Writer:**
- Current capacity: Single concurrent writer via better-sqlite3
- Limit: Write contention under high load
- Scaling path: Consider connection pooling or migration to PostgreSQL for multi-instance

**In-Memory Database:**
- Current capacity: RAM-dependent
- Limit: Memory exhaustion with large session histories
- Scaling path: Allow file-based SQLite with proper path configuration

**Deterministic Embedding:**
- Current capacity: 32-dimensional vectors (configurable)
- Limit: Low dimensional embeddings may miss semantic nuance
- Scaling path: Allow higher dimensions or switch to embedding API

## Dependencies at Risk

**js-tiktoken:**
- Risk: CJS module, potential compatibility issues with ESM-only environments
- Impact: Token counting for budget management breaks
- Migration plan: Alternative: use OpenAI tiktoken JS or count via approximation

**better-sqlite3:**
- Risk: Native module - requires rebuild for different Node versions/architectures
- Impact: Installation issues on some platforms
- Migration plan: Consider sql.js (pure JS) or better-sqlite3-multiple-ciphers

## Missing Critical Features

**MCP Protocol Implementation:**
- Problem: No actual MCP server implementation - just stubs
- Blocks: Integration with any IDE (Cursor, Windsurf, Cline) or tool (Claude Code)

**Configuration Management:**
- Problem: No standard config file or environment handling
- Blocks: Production deployment without code changes

**Error Recovery:**
- Problem: Limited retry/circuit breaker for cloud operations
- Blocks: Reliable cloud summarization

**CI Build/Test Gate:**
- Problem: No GitHub Actions workflow runs `tsc --noEmit`, lint, or `npm test`
- Blocks: Confidence that PRs (including Dependabot updates) compile and pass tests before merge to `main`

## Test Coverage Gaps

**Adapter Tests:**
- What's not tested: Adapter factory detection, individual adapter implementations
- Files: `src/adapters/factory.ts`, `src/adapters/ide/*.ts`, `src/adapters/global/*.ts`
- Risk: Adapter detection logic may fail in untested environments
- Priority: High

**Cloud Summarizer:**
- What's not tested: Cloud API fallback, error handling paths
- Files: `src/core/summarize/cloudSummarizer.ts`
- Risk: Cloud summarization failures not properly handled
- Priority: High

**E2E Tests:**
- What's not tested: Full CLI invocation, adapter installation flows
- Files: `src/cli/commands/run.ts`
- Risk: Integration issues in production not discovered
- Priority: Medium

---

*Concerns audit: 2026-06-10*
