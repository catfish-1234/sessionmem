# External Integrations

**Analysis Date:** 2026-06-10

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
- `.github/workflows/security.yml` - "Security Scan" GitHub Actions workflow
  - Triggers: push to `main`, all pull requests
  - Runs on `ubuntu-latest`
  - Checks out full history (`fetch-depth: 0`)
  - Tools: Semgrep (SAST, `config: auto`), Gitleaks (secret scanning), Trivy (filesystem vulnerability scan, HIGH/CRITICAL severity, fails build via `exit-code: 1`)
  - No build/test/lint job present in CI - only security scanning

**Dependency Updates:**
- `.github/dependabot.yml` - automated weekly dependency PRs for `npm` packages and `github-actions` versions

**Local Pre-Commit Hooks:**
- `.pre-commit-config.yaml` - `gitleaks` (v8.18.4) runs locally before commits to catch secrets pre-push

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

**CI/CD secrets:**
- `GITHUB_TOKEN` - used by Gitleaks Action in `.github/workflows/security.yml` (auto-provided by GitHub Actions)

**Secrets location:**
- In-code or config-passed (no .env file processing)
- `.gitignore` does not exclude any `.env*` files - none present in repo as of this scan

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

## Skill/Agent Tooling Integrations

**Caveman skills (JuliusBrussee/caveman):**
- `skills-lock.json` pins 7 skills fetched from the `JuliusBrussee/caveman` GitHub repo: `cavecrew`, `caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `caveman-review`, `caveman-stats`
- Each entry has a `computedHash` for integrity verification
- `sourceType: "github"` - skills pulled directly from GitHub source paths (`skills/<name>/SKILL.md`)

---

*Integration audit: 2026-06-10*
