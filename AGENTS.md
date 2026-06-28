
<!-- sessionmem:start -->

## sessionmem — Persistent Memory

sessionmem is an MCP memory layer that persists context across sessions. It is installed and active via the `sessionmem` MCP server. Use its tools to recall prior context and to store important decisions, facts, and context so they're available in future sessions without the user re-explaining. The user should never have to ask you to do this — it is part of how you work in this project.

### Startup
On Claude Code, prior context is injected automatically at session start by the
sessionmem `SessionStart` hook — you do not need to fetch it yourself. Do NOT
call `startup_inject_memories` on Claude Code: the hook already provides the
injection, so calling the tool would duplicate the context (it is not even
registered on Claude Code for this reason). If you do NOT see a "Relevant prior
context" block at the start of the session AND the `startup_inject_memories`
tool is available (e.g. the hook is not installed, or you are on a host without
hook support), call it once before any task work, or call `retrieveMemories`
with the current task as the query. Never inject twice if context was already
provided.

### When to store memories (storeMemory)
- User makes an architectural or design decision
- You discover a non-obvious project constraint or convention
- A debugging session reveals an important root cause
- User states a preference about how they want things done
- A warning or pitfall is discovered that future sessions should know about

### When to retrieve memories mid-session (retrieveMemories)
- Before making architectural decisions (check if prior decisions exist)
- When the user references something from a previous session
- When working in an area of the codebase that may have stored warnings or decisions

### At session end (RECOMMENDED — do this without being asked)
Before the session ends, persist what was accomplished so the next session starts
informed. Store a concise `summary` memory (importance 7) of the key outcomes, plus
any new decisions, facts, or warnings. Use `batchStoreMemory` to write several at
once. This is what makes context survive across sessions and saves tokens later.

### Memory kinds
- `decision` — architectural or design choices (importance: 7-9)
- `fact` — project constraints, conventions, patterns (importance: 5-7)
- `warning` — pitfalls, gotchas, things that broke before (importance: 8-10)
- `preference` — how the user likes things done (importance: 5-7)
- `summary` — session summaries (importance: 7)

### Other tools
- `listMemories` — browse all stored memories for this project
- `getMemory` — fetch a specific memory by ID
- `forgetMemory` — delete an outdated or incorrect memory
- `batchStoreMemory` — store multiple memories in one call (use at session end)
- `stats` — check memory count and health

### Session Pipeline Tools (automation / hook-driven)
These tools power the session-analytics and auto-summarization pipeline. They are
normally invoked by hooks (e.g. the Claude Code `SessionStart`/`SessionEnd` hooks),
not called manually by agents during a task. They are documented here for hosts
without hook support.

- `ingestSessionEvents` — called during a session to record conversation events
  (turns, tool use) as raw payloads. Powers token-savings analytics and session
  summarization. Parameters: `projectId`, `sessionId`, `events` (array of
  `{eventIndex, eventType, payloadJson}`).
- `handleSessionEnd` — called at session end to run retention pruning and
  auto-summarize the ingested events into a summary memory. Parameters: `projectId`,
  `sessionId`, `memoryId` (optional, for summary upsert).

### Guidelines
- Don't store trivial or easily re-derivable information
- Don't retrieve memories every single turn — retrieve at task boundaries
- Keep memory content concise (1-3 sentences) and self-contained
- Use appropriate importance scores (see kinds above)

<!-- sessionmem:end -->
