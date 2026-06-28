import { createCliContext, type CliContext } from "../context.js";
import { handleSessionEndConfigSchema } from "../../core/api/contracts.js";

/**
 * Read the Claude Code hook JSON payload from stdin, if any. The `SessionEnd`
 * hook pipes a JSON object that includes `session_id`, `cwd`, and `reason`. When
 * the command is run interactively (TTY) or no payload arrives, returns `{}`.
 *
 * A short timeout guards against a non-TTY stdin that never reaches EOF so the
 * hook can never hang and block the session from ending.
 */
async function readHookPayload(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) {
    return {};
  }

  const raw = await new Promise<string>((resolve) => {
    let data = "";
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(data);
    };

    const timer = setTimeout(() => {
      // The non-TTY stdin never reached EOF. Detach our listeners and pause the
      // stream so the dangling read can't keep the event loop alive (which would
      // hang the hook), then resolve with whatever was buffered.
      process.stdin.removeAllListeners();
      process.stdin.pause();
      finish();
    }, 500);
    timer.unref?.();

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });

  if (raw.trim() === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the session id for the session-end pipeline. Prefers the hook
 * payload's `session_id`, then the Claude Code `CLAUDE_CODE_SESSION_ID` env var
 * (set inside a Claude Code session), and finally a stable per-day fallback so
 * the retention prune still runs even with no session context.
 */
function resolveSessionId(payload: Record<string, unknown>): string {
  const fromPayload = payload.session_id;
  if (typeof fromPayload === "string" && fromPayload.trim() !== "") {
    return fromPayload.trim();
  }
  const fromEnv = process.env.CLAUDE_CODE_SESSION_ID;
  if (fromEnv && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  return `session-end-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * `sessionmem session-end` — the deterministic write-side counterpart to
 * `session-start`. Installed as a Claude Code `SessionEnd` hook so the
 * session-end pipeline runs automatically once per session:
 *  1. Auto-summarize any ingested session events into a durable memory.
 *  2. Run a light retention prune of memories older than the retention window.
 *
 * Then prints a one-line human summary of what happened. Every error is
 * swallowed so a session can never be blocked from ending.
 */
export async function sessionEndCommand(ctx?: CliContext): Promise<void> {
  try {
    const payload = ctx ? {} : await readHookPayload();
    const context = ctx ?? createCliContext();
    const sessionId = resolveSessionId(payload);

    const result = await context.service.call("handleSessionEnd", {
      projectId: context.projectId,
      sessionId,
      sourceAdapter: "sessionmem-cli",
      // Resolve the default config (autoSummarize on, threshold 3 events, local
      // summarizer; cloud summarization stays opt-in) so the call matches the
      // request type without relying on the schema default at the call site.
      config: handleSessionEndConfigSchema.parse({}),
    });

    if (!result.ok) {
      // Never block session end — report quietly to stderr only.
      process.stderr.write(
        `[sessionmem] session-end: ${result.error.message}\n`,
      );
      return;
    }

    switch (result.status) {
      case "stored":
        console.log(
          `sessionmem: session summary stored (${result.usedMode}); retention prune applied.`,
        );
        break;
      case "skipped_threshold":
        console.log(
          "sessionmem: not enough session events to summarize; retention prune applied.",
        );
        break;
      case "skipped_disabled":
        console.log(
          "sessionmem: auto-summarization disabled; retention prune applied.",
        );
        break;
      case "failed":
        console.log(
          "sessionmem: session summarization failed (recorded); retention prune applied.",
        );
        break;
    }
  } catch (err) {
    // Best-effort: a failure here must never fail the session-end hook.
    process.stderr.write(
      `[sessionmem] session-end skipped: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
