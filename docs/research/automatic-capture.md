# Automatic transcript capture

Research reviewed on October 18, 2026, before implementation. This change adopts
approaches only. No competitor source code was copied or adapted.

| Project and primary sources | Observed approach | Takeaway for sessionmem |
| --- | --- | --- |
| [claude-mem hooks](https://github.com/thedotmack/claude-mem/blob/main/plugin/hooks/hooks.json), [worker service](https://github.com/thedotmack/claude-mem/blob/main/docs/public/architecture/worker-service.mdx) | SessionStart starts a worker; async tool and stop hooks enqueue capture. The worker exposes health checks and separate start, stop, status and log controls. | Start capture automatically, keep explicit controls, and diagnose capture independently of registration. Keep the existing Claude Code hooks. |
| [Mem0 Claude Code plugin](https://github.com/mem0ai/mem0/blob/main/integrations/claude-code-plugin/README.md), [OpenClaw integration](https://github.com/mem0ai/mem0/blob/main/integrations/openclaw/README.md) | Hooks save local evidence; detached workers flush batches and survive host exit. Capture has pause/resume controls. The OpenClaw integration filters and redacts automatic capture. The previously indexed `mem0-plugin/scripts/auto_capture.py` path is now absent; the current plugin README was reviewed instead. | Keep capture local and redacted, preserve restart checkpoints, and expose enable/disable/status. This change keeps the existing offline summarizer. |
| [Cognee Claude Code integration](https://github.com/topoteretes/cognee-integrations/blob/main/integrations/claude-code/README.md) | SessionStart bootstraps a background watcher, write hooks stage capture, and detached final-sync workers handle exit. Persisted markers coordinate retries and avoid duplicate work. Logs and diagnostics expose failures. | Reuse the existing persistent transcript checkpoints and event IDs. Log failures and make stale capture visible in doctor. |
| [Engram installation](https://github.com/Gentleman-Programming/engram/blob/main/docs/INSTALLATION.md), [daemon control discussion](https://github.com/Gentleman-Programming/engram/issues/1462) | Local memory tooling also uses a background service. The daemon discussion describes stale executable paths and service/session process collisions as operational problems. The discussion is a reported problem, not an implemented guarantee. | Pin absolute runtime and entry-point paths, refresh one stable registration, and validate the registered paths. |

Sessionmem uses OS login supervision rather than requiring a host hook to start
capture. This covers Codex and Cursor installations without wired capture hooks.
The OS implementations share an `enable`, `disable`, `status` interface. They
update one stable per-user registration and start it immediately. The watcher
records completed sweeps separately from the OS registration so doctor can report
capture that has stopped or is failing.

The npm binary is a JavaScript entry point. Services invoke its absolute path
through the absolute Node executable running install. They do not use npm shims,
`npx`, an interactive shell, or PATH lookup. Changing Node installations requires
`sessionmem autostart enable` again.

Native definitions were also checked with `systemd-analyze verify`, Python's
plist parser, and the [Microsoft Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema).
The task uses schema version 1.3, unlimited execution time, and the schema's
maximum 255 restart attempts at one-minute intervals. Windows status and stop
checks use [numeric HRESULTs](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-error-and-success-constants)
rather than localized error text.

## Validation boundaries

CI mocks the OS supervisor commands, tests all three native definitions and
command sequences, and runs the real watcher against synthetic transcripts.
The packaged-install smoke test uses that same test-only supervisor. It does not
validate the live login behavior of launchd, systemd or Task Scheduler.

Manual verification required before release:

- macOS: install from a normal GUI login as an ordinary user. Confirm the plist
  in `~/Library/LaunchAgents`, `launchctl print gui/<uid>/io.sessionmem.watch`,
  immediate capture, and capture after logout/login with the terminal closed.
  Repeat install and confirm one loaded job. Check paths containing spaces.
  Disable, enable and uninstall; verify the job stops and the plist is removed.
- Linux: use a desktop/login with systemd's user manager. Confirm
  `systemctl --user is-enabled sessionmem-watch.service` and `is-active`, capture
  after login with no terminal, and restart after killing the watcher. Repeat
  install and check one unit. Disable/enable and uninstall must stop capture and
  remove the unit. Also verify install reports a useful failure without a user
  bus; it must not claim capture succeeded.
- Windows: install without elevation as the current user. Confirm one Scheduled
  Task with that user's logon trigger, immediate capture, capture after logging
  out/in, paths with spaces/non-ASCII characters, and no interactive prompt.
  Confirm unlimited runtime, restart after a failing process, and battery
  settings. Repeat install, disable/enable, and uninstall; verify no old task or
  watcher remains. Test on a non-English Windows installation as well.
- Each OS: append a real Codex or Cursor conversation and confirm imported
  memories, a fresh checkpoint and timestamped `logs/watch.log` output. Move or
  remove the registered runtime/entry point and check doctor's binary-path fix
  hint. Stop capture long enough to stale the checkpoint and check the capture
  failure hint. Uninstall must preserve memories unless `--purge` is supplied.
