# Architecture

**Analysis Date:** 2026-06-05

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        CLI / Entry Point                             │
│                   `src/cli/commands/run.ts`                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Adapter Layer (Infrastructure)                 │
│         `src/adapters/` - IDE & Global Tool Integrations            │
├────────────────────┬────────────────────┬─────────────────────────────┤
│    IDE Adapters    │ Global Adapters   │      Contract/Capabilities│
│  `ide/cursor.ts`  │ `global/claudeCode│  `contract/hostAdapter`   │
│  `ide/windsurf.ts`│   .ts`            │  `capabilities/fallback`  │
│  `ide/cline.ts`   │ `global/antigrav` │                            │
└────────────────────┴────────────────────┴─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Domain Layer (Core Business Logic)                │
│                         `src/core/`                                  │
├─────────────┬──────────────┬──────────────┬─────────────────────────┤
│    API      │   Storage    │   Embed      │      Retrieve           │
│ contracts   │ memoryRepo   │ deterministic│ retrieveMemories        │
│ errors      │ sessionEvents│ embed.ts     │ score.ts                │
│ memoryCore  │ repo.ts      │ reembedPolicy│ recencyBands.ts         │
│ Service     │ types.ts     │              │ importance.ts           │
├─────────────┼──────────────┼──────────────┼─────────────────────────┤
│  Summarize  │  Injection   │   Schema     │                         │
│ localSum..  │ tokenBudget  │ runMigrations│                         │
│ cloudSum..  │ formatStartup│ migrations/  │                         │
│ strategySel│ Injection.ts │              │                         │
└─────────────┴──────────────┴──────────────┴─────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Data Layer (Persistence)                          │
│              SQLite via better-sqlite3                              │
│  `src/core/storage/db.ts`                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| MemoryCoreService | Main service exposing memory operations | `src/core/api/memoryCoreService.ts` |
| SessionLifecycleService | Handles session end, summarization | `src/core/api/sessionLifecycleService.ts` |
| Contract Layer | Zod schemas for request/response validation | `src/core/api/contracts.ts` |
| MemoryRepo | CRUD operations for memories | `src/core/storage/memoryRepo.ts` |
| SessionEventsRepo | Event persistence | `src/core/storage/sessionEventsRepo.ts` |
| DeterministicEmbed | Text embedding with normalization | `src/core/embed/deterministicEmbed.ts` |
| RetrieveMemories | Ranked retrieval with scoring | `src/core/retrieve/retrieveMemories.ts` |
| LocalSummarizer | Local-only session summarization | `src/core/summarize/localSummarizer.ts` |
| TokenBudget | Token counting and budget trimming | `src/core/injection/tokenBudget.ts` |
| FormatStartupInjection | Format memories for injection | `src/core/injection/formatStartupInjection.ts` |
| AdapterFactory | Environment detection and adapter selection | `src/adapters/factory.ts` |
| IDE Adapters | Cursor, Windsurf, Cline integration | `src/adapters/ide/*.ts` |
| Global Adapters | ClaudeCode, Antigravity, Codex, QCoder | `src/adapters/global/*.ts` |

## Pattern Overview

**Overall:** Layered Architecture with Domain-Driven Design elements

**Key Characteristics:**
- Clear separation between domain logic (core), infrastructure (adapters), and entry points (CLI)
- Service-oriented design with MemoryCoreService as the central facade
- Repository pattern for data access (memoryRepo.ts, sessionEventsRepo.ts)
- Contract-based interfaces via Zod schemas for type-safe API
- Adapter pattern for multi-IDE support with factory for detection
- Event sourcing for session events

## Layers

**API Layer:**
- Purpose: Exposes business operations and handles request/response mapping
- Location: `src/core/api/`
- Contains: memoryCoreService.ts, sessionLifecycleService.ts, contracts.ts, errors.ts
- Depends on: Storage, Embed, Retrieve, Summarize
- Used by: Adapters

**Storage Layer:**
- Purpose: Database operations and data persistence
- Location: `src/core/storage/`
- Contains: db.ts (database connection), memoryRepo.ts, sessionEventsRepo.ts, types.ts
- Depends on: better-sqlite3
- Used by: API layer

**Domain - Embed:**
- Purpose: Text normalization and deterministic embedding generation
- Location: `src/core/embed/`
- Contains: deterministicEmbed.ts, textNormalize.ts, embeddingVersion.ts
- Used by: API layer, Retrieve layer

**Domain - Retrieve:**
- Purpose: Ranked memory retrieval with scoring algorithms
- Location: `src/core/retrieve/`
- Contains: retrieveMemories.ts, score.ts, recencyBands.ts, importance.ts, decay.ts
- Used by: API layer, Injection layer

**Domain - Summarize:**
- Purpose: Session summarization (local and cloud strategies)
- Location: `src/core/summarize/`
- Contains: localSummarizer.ts, cloudSummarizer.ts, summaryShape.ts, strategySelector.ts, redaction.ts
- Used by: SessionLifecycleService

**Domain - Injection:**
- Purpose: Token budget management and output formatting for context injection
- Location: `src/core/injection/`
- Contains: tokenBudget.ts, formatStartupInjection.ts
- Used by: Adapters

**Adapters Layer:**
- Purpose: Infrastructure integration with IDEs and global tools
- Location: `src/adapters/`
- Contains: factory.ts, generic.ts, ide/*, global/*, contract/*, capabilities/*, tools/*
- Depends on: Domain layer via contracts
- Used by: CLI

## Data Flow

### Primary Request Path

1. **Entry**: CLI command (`src/cli/commands/run.ts`) starts MCP server
2. **Detection**: AdapterFactory.detectAdapter() identifies host environment
3. **Adapter**: Selected adapter calls MemoryCoreService methods
4. **Service**: MemoryCoreService validates request via contracts (Zod)
5. **Domain**: Business logic executed (embedding, retrieval, summarization)
6. **Storage**: Database operations via repository layer
7. **Response**: Typed response returned through adapter to host

### Session Lifecycle Flow

1. **Ingest**: Events collected via `ingestSessionEvents`
2. **End**: `handleSessionEnd` triggers summarization
3. **Strategy**: StrategySelector chooses local vs cloud summarization
4. **Summarize**: LocalSummarizer or CloudSummarizer processes events
5. **Store**: Summary stored as memory with embedding
6. **Response**: Status returned (stored/skipped/failed)

**State Management:**
- SQLite for persistent state (memories, events, feedback)
- In-memory options available via better-sqlite3
- Session-scoped event accumulation before summarization

## Key Abstractions

**MemoryCoreService:**
- Purpose: Central facade exposing all memory operations
- Examples: `src/core/api/memoryCoreService.ts`
- Pattern: Service facade with typed method dispatch

**HostAdapterContract:**
- Purpose: Interface for IDE/tool integrations
- Examples: `src/adapters/ide/cursor.ts`, `src/adapters/global/claudeCode.ts`
- Pattern: Adapter pattern with factory for environment detection

**Repository Pattern:**
- Purpose: Abstract database operations
- Examples: `src/core/storage/memoryRepo.ts`, `src/core/storage/sessionEventsRepo.ts`
- Pattern: Repository with typed query methods

## Entry Points

**CLI Run Command:**
- Location: `src/cli/commands/run.ts`
- Triggers: `sessionmem run` command
- Responsibilities: Initializes adapter, starts MCP server, logs startup

**Memory Core Service Factory:**
- Location: `src/core/api/memoryCoreService.ts`
- Triggers: Created by adapters with db dependency
- Responsibilities: All memory CRUD operations, retrieval, statistics

**Session Lifecycle Service:**
- Location: `src/core/api/sessionLifecycleService.ts`
- Triggers: Called via handleSessionEnd method
- Responsibilities: Session summarization with fallback logic

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. SQLite operations via better-sqlite3 are synchronous.
- **Global state:** Database connection passed as dependency; no module-level singletons
- **Circular imports:** None detected. Clear layer boundaries enforced.
- **Type system:** Full TypeScript with Zod for runtime validation

## Anti-Patterns

### GenericMCPAdapter Stub

**What happens:** `src/adapters/generic.ts` has a stub implementation that throws "Method not implemented"
```typescript
async call<M extends MemoryCoreMethod>(
  method: M,
  request: MemoryCoreRequest<M>,
): Promise<HostAdapterResult<M>> {
  throw new Error("Method not implemented.");
}
```
**Why it's wrong:** Adapters cannot actually fulfill requests without a real MCP server implementation
**Do this instead:** Implement stdio-based MCP protocol using @modelcontextprotocol/sdk

### Missing Cloud Summarizer Implementation

**What happens:** `src/core/summarize/cloudSummarizer.ts` is imported but implementation may be incomplete
**Why it's wrong:** Cloud summarization fallback will fail when enabled
**Do this instead:** Complete cloudSummarizer.ts with Anthropic API integration

### No Build Configuration

**What happens:** No tsconfig.json or bundler configuration present
**Why it's wrong:** No clear build process for production deployment
**Do this instead:** Add tsconfig.json and potentially vite/rolldown config for bundling

## Error Handling

**Strategy:** Error envelope pattern with typed error codes

**Patterns:**
- DomainError with codes (VALIDATION, NOT_FOUND, INTERNAL) in `src/core/api/errors.ts`
- ErrorResponseEnvelope wraps all errors in responses
- Service methods catch and transform errors to envelope format

## Cross-Cutting Concerns

**Logging:** Basic console logging, file append for CLI startup (`~/.sessionmem/logs/mcp.log`)

**Validation:** Zod schemas in contracts.ts with parseRequest helper

**Authentication:** LocalOnlyPolicy default (localOnly: true), cloud requires explicit opt-in

---

*Architecture analysis: 2026-06-05*