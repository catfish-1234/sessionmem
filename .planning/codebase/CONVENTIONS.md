# Coding Conventions

**Analysis Date:** 2026-06-05

## Naming Patterns

**Files:**
- kebab-case: `memory-core-service.ts`, `session-events-repo.ts`, `token-budget.ts`
- Suffix indicates type: `*.ts` for implementation, `*.spec.ts` for tests

**Functions:**
- camelCase: `createMemoryCoreService`, `retrieveMemories`, `handleSessionEnd`
- Action verbs: `insert`, `upsert`, `list`, `update`, `record`, `format`
- Factory pattern: `create*` for service factories

**Variables:**
- camelCase: `db`, `input`, `parsed`, `dimension`, `queryVector`
- Prefixes for database records: `project_id`, `session_id` (snake_case in DB layer)
- DTO suffix for data transfer: `MemoryDto`, `RetrievedMemoryDto`

**Types:**
- PascalCase: `MemoryRecord`, `RetrievedMemoryCandidate`, `LocalSummarizeInput`
- Descriptive suffixes: `Input`, `Output`, `Options`, `Deps`, `Config`
- Enum values: camelCase in code, literal strings in Zod schemas

## Code Style

**Formatting:**
- No explicit prettier configuration found
- 2-space indentation observed
- Semicolons at end of statements

**Linting:**
- No ESLint configuration found
- No biome.json found

**TypeScript:**
- Explicit return types on exported functions
- Type imports from zod: `import { z } from "zod"` with schema inference

## Import Organization

**Order:**
1. External packages (better-sqlite3, zod, js-tiktoken)
2. Internal modules from src/core (relative imports with `.js` extension)
3. Internal modules from src/adapters

**Path Aliases:**
- None configured - all imports use relative paths

**Example:**
```typescript
import type { Database } from "better-sqlite3";
import { ZodError, type ZodType } from "zod";
import { deterministicEmbed } from "../embed/deterministicEmbed.js";
import { retrieveMemories } from "../retrieve/retrieveMemories.js";
import type { RetrievedMemoryCandidate } from "../retrieve/retrieveMemories.js";
```

## Error Handling

**Patterns:**
- Custom DomainError with typed codes: `new DomainError("VALIDATION", "message", details)`
- Error envelope pattern: `{ ok: false, error: { code, message, details? } }`
- Try-catch in service methods with error transformation
- Database errors caught and wrapped

**Error Codes:**
- VALIDATION - Request validation failures
- NOT_FOUND - Resource not found
- INTERNAL - Unexpected internal errors

## Logging

**Framework:** console (console.log, console.error)

**Patterns:**
- Startup logging to file: `~/.sessionmem/logs/mcp.log`
- Adapter install/uninstall confirmation
- MCP server status messages

## Comments

**When to Comment:**
- Complex logic blocks (scoring algorithms, similarity calculations)
- Fallback logic and retry strategies
- Configuration defaults and rationale

**JSDoc/TSDoc:**
- Not heavily used
- Some @returns annotations in key functions
- Interface JSDoc in contract definitions

## Function Design

**Size:** Generally focused, single responsibility

**Parameters:**
- Dependency Injection objects: `CreateMemoryCoreServiceDeps`
- Input objects: `LocalSummarizeInput`, `RetrieveMemoriesInput`
- Options with defaults: `FormatStartupInjectionOptions`

**Return Values:**
- Typed responses via Zod: `Promise<MemoryCoreResponseMap[M]>`
- Result objects with ok flag for error handling
- Named result interfaces: `RecordMemoryUseResult`, `SummarizerResult`

## Module Design

**Exports:**
- Named exports for factories and utilities
- Re-export patterns in index files not used (flat structure)

**Barrel Files:**
- Not used - direct imports from specific files

## Database Conventions

**Naming:**
- Tables: snake_case: `memories`, `session_events`, `summarization_failures`, `memory_feedback`
- Columns: snake_case: `project_id`, `session_id`, `source_adapter`
- Primary keys: `id` (TEXT)

**Patterns:**
- Prepared statements for SQL
- Transaction wrappers for multi-statement operations
- SQLite datetime: `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

---

*Convention analysis: 2026-06-05*