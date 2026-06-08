# Testing Patterns

**Analysis Date:** 2026-06-05

## Test Framework

**Runner:**
- Vitest 4.0.8
- Config: None explicitly found (vitest defaults)
- Run command: `npm test` or `vitest run`

**Assertion Library:**
- Vitest built-in expect
- Chai (via @types/chai) available

**Run Commands:**
```bash
npm test                   # Run all tests (vitest run --reporter=dot)
npm run test:schema        # Run schema integration tests
vitest run                 # Direct vitest call
```

## Test File Organization

**Location:**
- Tests co-located: `tests/` directory parallel to `src/`
- Integration tests in `tests/integration/`
- Unit tests in `tests/unit/`
- Quality harness in `tests/quality/`

**Naming:**
- `*.spec.ts` suffix for all test files
- Descriptive: `memory-core-service.spec.ts`, `token-budget.spec.ts`

**Structure:**
```
tests/
├── integration/
│   ├── core/
│   │   ├── memory-core-service.spec.ts
│   │   ├── session-lifecycle-summary.spec.ts
│   │   └── ...
│   ├── retrieve/
│   │   ├── retrieve-ranked.spec.ts
│   │   └── ...
│   └── storage/
│       └── schema.spec.ts
├── unit/
│   ├── core/
│   │   └── cloud-status-warning.spec.ts
│   ├── embed/
│   │   └── deterministic-embed.spec.ts
│   ├── injection/
│   │   ├── token-budget.spec.ts
│   │   └── format-startup-injection.spec.ts
│   └── retrieve/
│       ├── scoring-weights.spec.ts
│       └── importance-decay.spec.ts
└── quality/
    └── injection-quality-harness.spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("memory core service contracts", () => {
  it("accepts ingestSessionEvents payload shape", () => {
    // Test implementation
  });

  it("ingestSessionEvents persists events and returns typed response", async () => {
    const db = openDb();
    const service = createMemoryCoreService({ db });
    // Test implementation
    db.close();
  });
});
```

**Patterns:**
- Async/await for service calls
- Fresh database per test: `openDb()` creates in-memory database
- Cleanup: `db.close()` in test body
- Schema validation tests separate from integration tests

## Mocking

**Framework:** Vitest mocking (vi.mock)

**Patterns:**
- Direct imports without heavy mocking
- Database in-memory for tests
- Service dependency injection for testability

**What to Mock:**
- External APIs (Anthropic in cloud summarization tests)
- File system operations (logging)

**What NOT to Mock:**
- In-memory SQLite (better-sqlite3 handles this)
- Core domain logic (tested directly)

## Fixtures and Factories

**Test Data:**
```typescript
// Inline test data
const events = [
  {
    id: "evt-1",
    eventIndex: 0,
    eventType: "user_message",
    payloadJson: "{\"text\":\"hello\"}",
  },
];
```

**Location:**
- Inline within test files (no separate fixtures directory)

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
# No coverage command configured
```

## Test Types

**Unit Tests:**
- Domain logic: scoring weights, importance decay, token budget
- Embedding: deterministic embed output
- Injection: formatStartupInjection output

**Integration Tests:**
- Full service flow: memoryCoreService with real database
- Session lifecycle: end-to-end summarization
- Retrieval: ranked retrieval with scoring

**E2E Tests:**
- Not present

## Common Patterns

**Async Testing:**
```typescript
it("should do something async", async () => {
  const result = await service.method(request);
  expect(result.ok).toBe(true);
});
```

**Error Testing:**
```typescript
it("throws on invalid input", () => {
  expect(() => parseRequest(schema, invalidInput)).toThrow();
});
```

**Database Tests:**
```typescript
it("persists and retrieves data", async () => {
  const db = openDb();  // In-memory
  const service = createMemoryCoreService({ db });
  // ... test operations
  db.close();
});
```

---

*Testing analysis: 2026-06-05*