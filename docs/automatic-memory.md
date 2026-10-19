# Automatic capture and recall

Install once and restart the host so it loads its MCP configuration and guidance.
The installed flow does not ask the user to run scans, recall commands or save
commands during ordinary agent work. Host tool permissions must allow the memory
tools. `sessionmem doctor --adapter <name>` checks the configured flow and gives
repair hints for missing hooks, stale instructions, disabled MCP wiring and stale
watcher checkpoints.

## Host audit and behavior

| Host | Capture after install | Session-start recall | Recall on prompts |
| --- | --- | --- | --- |
| Claude Code | PostToolUse captures Bash/Edit/Write/MultiEdit; SessionEnd summarizes; login watcher also imports transcripts | SessionStart hook catches up transcripts and injects context | UserPromptSubmit hook retrieves context for the submitted prompt |
| Codex | Login-started watcher imports local rollout transcripts | Global AGENTS.md and MCP instructions tell the agent to search before work and fetch selected details | Instructions tell the agent to search for a new topic |
| Cursor | Login-started watcher imports supported local composer SQLite records | Project always-apply rule and global MCP instructions tell the agent to search before work | Same instruction-driven topic recall |
| Windsurf | Agent calls storeMemory/batchStoreMemory under global rules; no transcript importer | Global rules and MCP instructions | Instruction-driven topic recall |
| Cline | Agent calls storeMemory/batchStoreMemory under installed rules; no transcript importer | Installed rules and MCP instructions | Instruction-driven topic recall |
| Antigravity, QCoder adapters | Agent tool saves when the host loads the configured MCP server and guidance; no transcript importer | Instruction-driven; existing adapter file paths are unverified against the native products | Instruction-driven; host loading must be verified |
| Generic MCP | Agent tool saves when the host reads project AGENTS.md or MCP instructions; no transcript importer | Instruction-driven, dependent on host support | Instruction-driven topic recall |

Only Claude Code has deterministic host hooks in this integration. Instruction-
driven recall is configured by install, but doctor cannot prove that a model
executed the instructions or that an unverified native host loaded a guessed
configuration path. Doctor marks Antigravity/QCoder automation unestablished and
gives a native-settings verification hint. Its output identifies this distinction. The tests simulate
an agent following the installed instructions; they do not launch proprietary
host interfaces or claim that every model obeys instructions.

The watcher starts immediately at install and at login through launchd on macOS,
a user systemd service on Linux, or Task Scheduler on Windows. It polls supported
transcripts every five seconds by default. Capture requires readable transcript
files in a supported format. A missing directory is valid before the first
session; an unsupported format or unreadable source is a diagnostic failure.
No user action is needed to import later sessions while the service is healthy.

Claude Code SessionStart and a new MCP server connection also perform an
incremental catch-up. A session opened immediately after another session can
therefore recall newly written transcript events before the next watcher poll.
The MCP server advertises the startup, new-topic recall and decision-save flow
in its protocol instructions for all hosts. Existing user prose is preserved
when managed guidance blocks are updated.

Cursor rules are project scoped. The old home-level `.cursor/rules` location did
not establish a rule for arbitrary projects. Install now writes the rule in the
current project, repairs `alwaysApply:true`, and supplies the same flow through
the global MCP server's instructions in other projects. A host that ignores MCP
instructions needs an active native rule in that project.

Plain-terminal install detection recognizes Claude Code, Codex, Cursor and
Windsurf CLI executables when on PATH, plus the documented native Claude paths.
Other hosts still need selection at setup with `--adapter`. Configuration
directories alone are not treated as evidence of an installed host.

Cline's installed MCP entry preapproves the local search, detail and capture tools
so these calls do not require a separate user action each time. Deletion and
external operations are excluded. Other hosts retain their own permission rules.

## Diagnosis and repair

Doctor separately reports hook definitions, MCP startup and tool availability,
current agent instructions, capture mode and recall mode. For hookless hosts it
says that recall is instruction-driven and execution is unverified. For hosts
without transcript support it says that capture consists of agent-driven saves,
not background transcript import. Hook and guidance configuration are checked
against the current installed version. Failed guidance writes make install fail
instead of printing a successful setup message.

Doctor's MCP probe bypasses startup capture so diagnosis does not import
transcripts or alter the user's memories. Its isolated storage canary rolls back.
The watcher-health check requires a recent, successful checkpoint for the selected
database, rather than assuming that a registered service is running.

## CI evidence

`tests/integration/cli/automatic-memory-flow.spec.ts` runs in the CI OS matrix.
It uses a temporary home and project. The OS supervisor commands are simulated,
but the registered watcher command performs real transcript ingestion.

The Claude case installs the actual hook definitions, feeds capture events,
ends the session, starts a new session, and verifies the startup and prompt
context envelopes contain the stored database decision. The Codex and Cursor
cases create real-format transcript fixtures, install and run the automatic
watcher sweep, run doctor, then open a new MCP session. A simulated agent follows
the installed instructions and verifies selected full details reach its context.
No manual import or scan command is used.
