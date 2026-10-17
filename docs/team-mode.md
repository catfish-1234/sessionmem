# Team Mode (Shared Memory)

Team mode shares `sessionmem` memories through a directory everyone on the team can read and write, such as a network drive or synced folder. With team mode enabled, `sessionmem sync` writes your local memories there and reads teammates' memories into your database. Your agent can then use decisions, warnings, and facts recorded by the team.

Team mode is off by default. Enable it to start sharing.

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

Each teammate writes one snapshot file named after their OS username. Each project has its own subdirectory to keep snapshots separate.

To check the current state:

```
sessionmem team status
```

This reports whether team mode is enabled and whether the shared path is reachable.

## Usage: syncing

Once team mode is enabled, run:

```
sessionmem sync
```

Each `sync` runs two steps:

1. **Push**: writes a full snapshot of this project's local memories to
   `{sharedPath}/{project_id}/{username}.json`. The write is atomic (a temp file
   is written in the same directory and then renamed) so teammates don't read a
   partly written snapshot.
2. **Pull**: reads every other `*.json` snapshot in the project directory and
   merges those memories into your local database.

When it finishes, `sync` prints a summary:

```
Pushed N memories, pulled M new + updated K from teammates.
```

`N` is the number of local memories shared, `M` is the number of new teammate memories added, and `K` is the number of existing memories updated from teammate snapshots.

If team mode is disabled, `sync` makes no changes and tells you to run `team enable` first.

## Provenance and author annotation

Each memory records its source:

- **`author`**: the OS username of whoever created the memory.
- **`created_at`**: when it was first created.

In the agent's startup context, teammate memories have an `author:` prefix showing their recorded author, for example:

```
- [decision] alice: decided to use X (...)
```

Your own memories have no prefix. Older memories with an empty author also have no prefix. The prefix appears when the recorded author differs from your local username.

## Conflict behavior

When the same memory id exists locally and in a teammate's snapshot, `sync` resolves it as follows:

- **Content**: sync uses last-write-wins by id, keeping the most recent content.
- **Importance**: a teammate's snapshot cannot lower your local copy's importance score.
- **Cross-project id collisions**: records whose ids already belong to a different project are skipped.
- **Redaction**: every pulled record is checked again using your secret redaction policy.

## Disable and recovery

To stop syncing and keep memories already pulled from teammates:

```
sessionmem team disable
```

To also delete teammate-authored memories:

```
sessionmem team disable --remove-team-memories
```

This deletes the teammate-authored memories for this project, leaving only the memories you authored locally.

## Trust boundary and security

Anyone with write access to the shared path can add memories that your agent may use. Control access through the shared directory's filesystem permissions:

- Restrict write access with OS filesystem permissions (ACLs) to the people you intend to share memories with.
- The `author` field is advisory. A person with write access can change it, so the `author:` prefix does not verify identity.
- `sessionmem` does not authenticate teammates, sign snapshots, or verify authorship. Enforce any additional access controls through the filesystem or file share.

## Failure recovery

When `sync` encounters filesystem or snapshot errors:

- **Missing or unwritable shared path**: `sync` reports the error to stderr and
  exits with a non-zero status. Your local memories are untouched.
- **A corrupt or truncated teammate file**: the file is skipped with a warning,
  and the rest of the pull continues.
- **An invalid record inside an otherwise-valid file**: the record is skipped
  with a warning; the remaining records still merge.
