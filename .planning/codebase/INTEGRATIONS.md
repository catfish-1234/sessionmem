# External Integrations

**Analysis Date:** 2026-06-05

## APIs & External Services

**AI Summarization:**
- Anthropic API (optional) - Used for cloud summarization when enabled
  - SDK/Client: Native fetch (no explicit SDK)
  - Auth: `anthropicApiKey` passed in config or `ANTHROPIC_API_KEY` env
  - Implementation: `src/core/summarize/cloudSummarizer.ts` (incomplete)

## Data Storage

**Databases:**
- SQLite (local)
  - Connection: In-memory or file path via better-sqlite3
  - Client: better-sqlite3 (synchronous API)
  - Schema: `src/core/schema/migrations/*.sql`

**File Storage:**
- Local filesystem only
  - Logs: `~/.sessionmem/logs/mcp.log`
  - Database: User-specified path or in-memory

**Caching:**
- None - Full retrieval from SQLite on each query

## Authentication & Identity

**Local-Only Mode:**
- Default policy: localOnly: true
- Implementation: `src/core/api/localOnlyPolicy.ts`
- No external auth required by default

**Cloud Opt-In:**
- Requires explicit `allowCloudSummarization: true` and `anthropicApiKey`
- Implemented in strategy selector

## Monitoring & Observability

**Error Tracking:**
- None - Errors logged to console

**Logs:**
- File-based logging for CLI startup: `~/.sessionmem/logs/mcp.log`
- Console output for adapter install/uninstall

## CI/CD & Deployment

**Hosting:**
- Self-hosted (runs within IDE/global tool context)

**CI Pipeline:**
- None detected (no GitHub Actions, etc.)

## Environment Configuration

**Required env vars:**
- None strictly required (defaults handle all cases)

**Detected env vars (for adapter detection):**
- `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_SESSION_ID` - Antigravity
- `CLAUDE_CODE_SESSION`, `TERM_PROGRAM` - Claude Code
- `CURSOR_APP_VERSION`, `TERM_PROGRAM` - Cursor IDE
- `TERM_PROGRAM` - Windsurf IDE
- `CLINE_SESSION_ID` - Cline IDE
- `CODEX_SESSION_ID` - Codex
- `QCODER_SESSION` - QCoder

**Secrets location:**
- In-code or config-passed (no .env file processing)

## Webhooks & Callbacks

**Incoming:**
- MCP protocol over stdio (planned but not fully implemented)

**Outgoing:**
- Anthropic API calls for cloud summarization (optional)

## MCP Server Status

**Implementation Gap:**
- `src/adapters/generic.ts` has stub `startMcpServer()` that only logs to console
- No actual @modelcontextprotocol/sdk integration
- MCP client integrations (Cursor, Windsurf, etc.) cannot actually communicate with sessionmem

---

*Integration audit: 2026-06-05*