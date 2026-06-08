# Technology Stack

**Analysis Date:** 2026-06-05

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code in `src/` and tests in `tests/`

**Secondary:**
- SQL - Database migrations in `src/core/schema/migrations/*.sql`

## Runtime

**Environment:**
- Node.js (targeting Node 18+ based on ESM usage)

**Package Manager:**
- npm (package-lock.json present, version ~10.x implied)
- Lockfile: Present (package-lock.json)

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
- (No explicit build tool configured - needs tsconfig.json)

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
- No tsconfig.json found - needs configuration
- No bundler (vite/rolldown/tsc) configuration found

## Platform Requirements

**Development:**
- Node.js 18+
- npm for dependency management

**Production:**
- Node.js runtime
- SQLite support via better-sqlite3 (native module)

---

*Stack analysis: 2026-06-05*