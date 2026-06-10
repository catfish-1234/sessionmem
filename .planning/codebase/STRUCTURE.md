# Codebase Structure

**Analysis Date:** 2026-06-10

## Directory Layout

```
sessionmem/
├── .github/
│   ├── dependabot.yml            # Weekly npm + github-actions update PRs
│   └── workflows/
│       └── security.yml          # Semgrep, Gitleaks, Trivy on push/PR
├── src/
│   ├── core/                    # Domain layer - business logic
│   │   ├── api/                 # Service layer and contracts
│   │   ├── embed/               # Embedding generation
│   │   ├── injection/           # Context injection formatting
│   │   ├── retrieve/             # Memory retrieval and scoring
│   │   ├── schema/               # Database migrations
│   │   ├── storage/              # Repository layer
│   │   └── summarize/            # Session summarization
│   ├── adapters/                 # Infrastructure - IDE integrations
│   │   ├── capabilities/         # Capability definitions
│   │   ├── contract/             # Interface definitions
│   │   ├── global/               # Global tool adapters
│   │   ├── ide/                  # IDE adapters
│   │   ├── tools/                # Tool definitions
│   │   ├── factory.ts            # Adapter detection factory
│   │   └── generic.ts            # Generic MCP adapter
│   └── cli/                      # CLI entry point
│       └── commands/
│           └── run.ts            # Main run command
├── dist/                          # Build output (tsc compile target, see tsconfig.json)
├── tests/
│   ├── integration/              # Integration tests
│   │   ├── core/                 # Service integration tests
│   │   ├── retrieve/             # Retrieval tests
│   │   └── storage/              # Storage/schema tests
│   ├── unit/                     # Unit tests
│   │   ├── core/                 # Core domain tests
│   │   ├── embed/                # Embedding tests
│   │   ├── injection/            # Injection tests
│   │   └── retrieve/             # Retrieval scoring tests
│   └── quality/                  # Quality harness tests
├── .claude/                      # Claude configuration
├── .agents/                      # Agent definitions
├── docs/                         # Documentation
├── .gitignore                    # Excludes node_modules/, *.log
├── .pre-commit-config.yaml       # Gitleaks pre-commit hook (v8.18.4)
├── tsconfig.json                 # TS build config (src/ -> dist/, strict, NodeNext)
├── package.json
├── package-lock.json             # npm lockfile (lockfileVersion 3)
└── skills-lock.json              # Locked Claude skill sources/hashes (e.g. caveman skill set)
```

## Directory Purposes

**`src/core/`:**
- Purpose: Domain layer containing all business logic
- Contains: Services, repositories, domain logic, schemas
- Key files: `memoryCoreService.ts`, `sessionLifecycleService.ts`, `contracts.ts`

**`src/core/api/`:**
- Purpose: Service layer and API contracts
- Contains: MemoryCoreService, SessionLifecycleService, Zod schemas
- Key files: `memoryCoreService.ts`, `sessionLifecycleService.ts`, `contracts.ts`, `errors.ts`

**`src/core/storage/`:**
- Purpose: Database operations and repository pattern
- Contains: Database connection, memory repo, session events repo
- Key files: `db.ts`, `memoryRepo.ts`, `sessionEventsRepo.ts`, `types.ts`

**`src/core/embed/`:**
- Purpose: Text embedding generation
- Contains: Deterministic embedder, text normalization
- Key files: `deterministicEmbed.ts`, `textNormalize.ts`, `embeddingVersion.ts`

**`src/core/retrieve/`:**
- Purpose: Memory retrieval and ranking
- Contains: Retrieval logic, scoring algorithms
- Key files: `retrieveMemories.ts`, `score.ts`, `recencyBands.ts`, `importance.ts`

**`src/core/summarize/`:**
- Purpose: Session summarization strategies
- Contains: Local summarizer, cloud summarizer, strategy selector
- Key files: `localSummarizer.ts`, `cloudSummarizer.ts`, `strategySelector.ts`, `summaryShape.ts`

**`src/core/injection/`:**
- Purpose: Token budget management and context formatting
- Contains: Token budget logic, startup injection formatting
- Key files: `tokenBudget.ts`, `formatStartupInjection.ts`

**`src/core/schema/`:**
- Purpose: Database schema management
- Contains: Migration runner, SQL migration files
- Key files: `runMigrations.ts`, `migrations/*.sql`

**`src/adapters/`:**
- Purpose: Infrastructure layer for IDE and tool integrations
- Contains: Adapter implementations, contracts, factory
- Key files: `factory.ts`, `generic.ts`, `hostAdapterContract.ts`

**`src/cli/`:**
- Purpose: Command-line interface entry point
- Contains: CLI commands
- Key files: `run.ts`

**`tests/`:**
- Purpose: Test suite organized by type
- Contains: Integration tests, unit tests, quality harness

**`.github/`:**
- Purpose: GitHub-native automation (CI workflows, dependency management)
- Contains: `workflows/security.yml` (Semgrep + Gitleaks + Trivy scan on push to `main` and PRs), `dependabot.yml` (weekly npm + github-actions update PRs)
- Key files: `.github/workflows/security.yml`, `.github/dependabot.yml`

**`dist/`:**
- Purpose: Compiled JavaScript output from `tsconfig.json` (`rootDir: src`, `outDir: dist`)
- Generated: Yes (via `tsc`)
- Committed: Currently present in working tree but not listed in `.gitignore` — verify intent before committing build output

## Key File Locations

**Entry Points:**
- `src/cli/commands/run.ts`: Main CLI entry point for `sessionmem run`

**Configuration:**
- `package.json`: Project dependencies and scripts
- `package-lock.json`: npm lockfile (lockfileVersion 3) — pins exact dependency versions for reproducible installs
- `tsconfig.json`: TypeScript compiler config — compiles `src/**/*.ts` to `dist/`, NodeNext module/resolution, ES2022 target, `strict: true`, excludes `tests`, `dist`, `node_modules`
- `skills-lock.json`: Locked references (source repo, path, content hash) for Claude Code skills installed under `.claude/`/`.agents/` (e.g., `caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `cavecrew` from `JuliusBrussee/caveman`)
- `.gitignore`: Excludes `node_modules/` and `*.log` from version control
- `.pre-commit-config.yaml`: Configures the `gitleaks/gitleaks` pre-commit hook (rev `v8.18.4`) to block commits containing secrets
- `.github/dependabot.yml`: Weekly automated dependency-update PRs for npm and GitHub Actions
- `.github/workflows/security.yml`: CI security scan job (`security`) running Semgrep, Gitleaks, and Trivy on push to `main` and on pull requests

**Core Logic:**
- `src/core/api/memoryCoreService.ts`: Central service facade
- `src/core/api/sessionLifecycleService.ts`: Session lifecycle handling
- `src/core/storage/db.ts`: Database connection

**Testing:**
- `tests/integration/core/memory-core-service.spec.ts`: Core service tests
- `tests/unit/injection/token-budget.spec.ts`: Token budget tests

## Naming Conventions

**Files:**
- kebab-case: `memory-core-service.ts`, `session-events-repo.ts`
- Descriptive nouns: `deterministicEmbed.ts`, `tokenBudget.ts`

**Functions:**
- camelCase: `createMemoryCoreService`, `retrieveMemories`
- Action verbs: `insertMemory`, `recordUse`, `handleSessionEnd`

**Types/Interfaces:**
- PascalCase: `MemoryRecord`, `RetrievedMemoryCandidate`, `LocalSummarizeInput`
- Suffix: `Deps`, `Input`, `Output`, `Options` where appropriate

**Directories:**
- kebab-case: `session-events-repo.ts`, `format-startup-injection.ts`

**Root-level config files:**
- Tool-conventional names preserved as-is: `.gitignore`, `.pre-commit-config.yaml`, `tsconfig.json`, `package-lock.json`, `skills-lock.json`
- GitHub automation lives under `.github/` using GitHub's required filenames (`dependabot.yml`, `workflows/<name>.yml`)

## Where to Add New Code

**New API Method:**
- Primary code: Add to `src/core/api/memoryCoreService.ts` methods object
- Contracts: Update `src/core/api/contracts.ts` with request/response schemas
- Tests: Add integration test in `tests/integration/core/`

**New Storage Repository:**
- Implementation: Add to `src/core/storage/` with new repo file
- Types: Update or add types in `src/core/storage/types.ts`
- Tests: Add integration tests in `tests/integration/storage/`

**New Adapter:**
- Implementation: Create in `src/adapters/ide/` or `src/adapters/global/`
- Factory: Update `src/adapters/factory.ts` to detect new environment
- Contract: Implement `HostAdapterContract` interface

**New Domain Logic:**
- Implementation: Add to appropriate `src/core/` subdomain
- Tests: Add unit tests in `tests/unit/`

**Utilities:**
- Shared helpers: `src/core/` subdirectories based on domain

**New CI checks:**
- Add steps to `.github/workflows/security.yml` for new scanners, or create a new workflow file under `.github/workflows/`
- Add new ecosystems to `.github/dependabot.yml` if new package managers are introduced

**New build settings:**
- Adjust `tsconfig.json` (`compilerOptions`, `include`/`exclude`) — keep `tests/`, `dist/`, `node_modules/` excluded from compilation

## Special Directories

**`.planning/`:**
- Purpose: Project planning documents and roadmap
- Generated: Yes (by this analysis and prior phases)
- Committed: Yes

**`.claude/`:**
- Purpose: Claude configuration and skills
- Generated: Yes
- Committed: Yes

**`.agents/`:**
- Purpose: Agent definitions
- Generated: Yes
- Committed: Yes

**`.github/`:**
- Purpose: CI workflows (security scanning) and Dependabot configuration
- Generated: No (hand-authored YAML)
- Committed: Yes

**`dist/`:**
- Purpose: TypeScript build output (`tsc` compiling `src/` per `tsconfig.json`)
- Generated: Yes
- Committed: Present in working tree as of this analysis but not yet excluded via `.gitignore` — confirm whether it should be tracked or ignored

---

*Structure analysis: 2026-06-10*
