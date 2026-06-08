# Codebase Structure

**Analysis Date:** 2026-06-05

## Directory Layout

```
sessionmem/
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
└── package.json
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

## Key File Locations

**Entry Points:**
- `src/cli/commands/run.ts`: Main CLI entry point for `sessionmem run`

**Configuration:**
- `package.json`: Project dependencies and scripts

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

---

*Structure analysis: 2026-06-05*