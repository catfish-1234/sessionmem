import { createCliContext, type CliContext } from "../context.js";

/**
 * Generic startup query. When few memories contain these literal tokens the
 * FTS pre-filter falls back to the importance/recency candidate set
 * (searchMemoryCandidatesFTS → searchMemoryCandidates), so the injection
 * surfaces the most important and recent memories rather than nothing.
 */
const STARTUP_QUERY =
  "session startup context recent decisions architecture warnings preferences";

/**
 * Emit prior project memories as Claude Code SessionStart hook output.
 *
 * This is the deterministic auto-injection path the user was missing: the
 * installed `SessionStart` hook runs `sessionmem session-start` at the start of
 * every Claude Code session and Claude Code adds this command's
 * `additionalContext` to the conversation — with zero reliance on the agent
 * choosing to call the `startup_inject_memories` tool.
 *
 * Contract notes:
 *  - ONLY the JSON envelope is written to stdout; diagnostics never touch
 *    stdout (Claude Code parses stdout as the hook result).
 *  - The command must never fail a session start: every error is swallowed and
 *    results in empty output (the session simply starts without injected
 *    context).
 *  - When there are no memories yet, nothing is emitted so a fresh project
 *    starts clean.
 */
export async function sessionStartCommand(ctx?: CliContext): Promise<void> {
  try {
    const context = ctx ?? createCliContext();
    const result = await context.service.call("retrieveMemories", {
      projectId: context.projectId,
      query: STARTUP_QUERY,
      limit: 20,
      mode: "auto" as const,
      depth: "default" as const,
    });

    if (
      result.ok &&
      result.total > 0 &&
      result.startupInjection.trim() !== ""
    ) {
      const payload = {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: result.startupInjection,
        },
      };
      process.stdout.write(JSON.stringify(payload));
    }
  } catch {
    // Never block session start — emit nothing on any failure.
  }
}
