# Team Mode (Shared Memory)

Team mode lets a group of teammates share `sessionmem` memories through a common filesystem path, such as a network drive, a synced folder, or any directory every teammate can read and write. When enabled, `sessionmem sync` pushes your local memories to the shared path and pulls your teammates' memories back into your local database, so the agent can surface decisions, warnings, and facts captured by anyone on the team.

Team mode is **off by default**. Nothing is shared until you explicitly enable it.

## Setup

Enable team mode by pointing it at a shared directory:

```
sessionmem team enable <shared-path>
```

`<shared-path>` must be a directory that all teammates can read and write, typically a network share or a folder synced across machines. The path is recorded in `~/.sessionmem/config.json` under the `team` section (`team.enabled` / `team.sharedPath`).

Inside the shared path, `sessionmem` uses a per-project, per-user file layout:

```
{sharedPath}/{project_id}/{username}.json
```

Each teammate writes a single snapshot file named after their OS username, scoped under the project's id. Different projects never collide because each gets its own sub-directory.

Inspect the current state at any time:

```
sessionmem team status
```

This reports whether team mode is enabled and whether the shared path is reachable.

## Usage: syncing

Once team mode is enabled, run:

```
sessionmem sync
```

A single `sync` does two things:

1. **Push**: writes a full snapshot of this project's local memories to
   `{sharedPath}/{project_id}/{username}.json`. The write is atomic (a temp file
   is written in the same directory and then renamed) so a teammate never reads a
   half-written snapshot off a network drive.
2. **Pull**: reads every other `*.json` snapshot in the project directory and
   merges those memories into your local database.

When it finishes, `sync` prints a summary:

```
Pushed N memories, pulled M new + updated K from teammates.
```

`N` is how many local memories you shared, `M` is how many brand-new teammate memories were added, and `K` is how many existing memories were updated from a teammate's snapshot.

If team mode is not enabled, `sync` is a clean no-op and tells you to run `team enable` first.

## Provenance and author annotation

Every memory carries provenance:

- **`author`**: the OS username of whoever created the memory.
- **`created_at`**: when it was first created.

When a teammate's memory is surfaced in the agent's startup context, it is shown with an `author:` prefix so you can see who it came from, for example:

```
- [decision] alice: decided to use X (...)
```

Memories you authored yourself render with **no** prefix. Legacy memories created before provenance existed (which have an empty author) also render without a prefix. The prefix appears **only** when a memory's author differs from your local username, so a memory is never mis-attributed.

## Conflict behavior

When the same memory id exists locally and in a teammate's snapshot, `sync` resolves it as follows:

- **Last-write-wins by id**: the most recent content for a given id wins (last-write-wins on content).
- **Importance is preserved when higher locally**: if your local copy has a higher importance score, that higher value is kept rather than being lowered by a teammate's snapshot.
- **Cross-project id collisions are skipped**: a memory whose id already belongs to a different project is never overwritten; it is skipped.
- **Pulled content is re-redacted**: secret redaction runs again on every pulled record, so a teammate's memory cannot import a secret your redaction policy would have stripped.

## Disable and recovery

Turn team mode off without losing anything:

```
sessionmem team disable
```

This stops syncing but keeps every memory you have already pulled from teammates. There is no data loss.

To fully revert to a local-only store, also delete teammate-authored memories:

```
sessionmem team disable --remove-team-memories
```

This deletes the teammate-authored memories for this project, leaving only the memories you authored locally.

## Trust boundary and security

Team mode trusts **everyone who has write access to the shared path.** This is a deliberate design choice, and it is important to understand it:

- The real security boundary is the **OS filesystem permissions (ACLs)** on the shared directory. Restrict write access to that directory to the people you intend to share memory with.
- The `author` value is **advisory provenance, not an authentication control.** A teammate with write access could set a fabricated author on a memory; the `author:` annotation tells you what the snapshot *claims*, not a verified identity.
- `sessionmem` does not authenticate teammates, sign snapshots, or verify authorship. If you need stronger guarantees, enforce them at the filesystem / share level.

In short: anyone who can write to the shared path can inject memories that your agent may surface. Treat the shared directory's access control as the security perimeter.

## Failure recovery

`sync` is defensive about a flaky shared filesystem:

- **Missing or unwritable shared path**: `sync` reports the error to stderr and
  exits with a non-zero status. Your local memories are untouched.
- **A corrupt or truncated teammate file**: that single file is skipped with a
  warning, and the rest of the pull continues. One bad snapshot never aborts the
  whole sync.
- **An invalid record inside an otherwise-valid file**: that single record is
  skipped with a warning; the remaining records in the file still merge.
