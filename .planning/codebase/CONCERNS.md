# Codebase Concerns

**Analysis Date:** 2026-06-05

## Tech Debt

**MCP Server Not Implemented:**
- Issue: `src/adapters/generic.ts` has stub `startMcpServer()` that only logs a message
- Files: `src/adapters/generic.ts`, `src/adapters/ide/*.ts`, `src/adapters/global/*.ts`
- Impact: Adapters cannot actually communicate with host IDEs/tools - MCP protocol not functional
- Fix approach: Implement stdio-based MCP server using @modelcontextprotocol/sdk

**No Build Configuration:**
- Issue: No tsconfig.json or bundler configuration present
- Files: Project root - missing `tsconfig.json`
- Impact: No clear build process for production deployment, type checking not centralized
- Fix approach: Add tsconfig.json with appropriate compiler options for ESM

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

## Known Bugs

**No Critical Bugs Detected:**
- No TODO/FIXME/HACK comments found in source
- Tests appear functional

## Security Considerations

**Hardcoded Secrets Risk:**
- Risk: API keys could be passed in config objects or environment variables not securely stored
- Files: `src/core/summarize/cloudSummarizer.ts`, `src/core/api/contracts.ts`
- Current mitigation: None - uses process.env or passed-in config
- Recommendations: Use secure secret management, document required env vars

**File System Log Location:**
- Risk: Log directory created in home directory without error handling
- Files: `src/cli/commands/run.ts`
- Current mitigation: try-catch around file write
- Recommendations: Add proper error handling for path issues

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

*Concerns audit: 2026-06-05*