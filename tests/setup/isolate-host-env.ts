/**
 * Run every spec as if no agent host were around it.
 *
 * sessionmem detects the host it runs under from environment variables (see
 * src/adapters/factory.ts), and it is meant to be developed from inside those
 * hosts. Run `npm test` from a Claude Code session and every CLI a spec spawns
 * inherits `CLAUDECODE=1` and the session id, reports itself as Claude Code,
 * and tags memories with that live session: 22 specs failed that way on a clean
 * checkout. A spec that is about host detection sets the variables it needs
 * itself, so removing the inherited ones changes nothing else.
 */
const HOST_VARIABLES = [
  "ANTIGRAVITY_APP_DATA_DIR",
  "ANTIGRAVITY_SESSION_ID",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CURSOR_AGENT",
  "CURSOR_CLI",
  "CURSOR_TRACE_ID",
  "CODEX_HOME",
  "OPENAI_CODEX",
  "QCODER_SESSION",
  "SESSION_ID",
];

for (const name of HOST_VARIABLES) delete process.env[name];
