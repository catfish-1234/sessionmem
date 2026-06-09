# Phase 5: CLI Lifecycle and Data Operations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 5-CLI Lifecycle and Data Operations
**Areas discussed:** CLI Framework, Install Health Check, Data Command Output Format, Export/Import Format

---

## CLI Framework

| Option | Description | Selected |
|--------|-------------|----------|
| commander | Battle-tested, zero-dep, excellent subcommand support. Standard for Node CLI tools. | ✓ |
| yargs | More powerful middleware/parsing, heavier. Good for complex flag combos. Overkill for this scope. | |
| No framework — manual | Keep raw argv parsing. More control, zero dep, but tedious to maintain across 11 commands. | |

**User's choice:** commander

---

| Option | Description | Selected |
|--------|-------------|----------|
| src/cli/index.ts | Central entry, all subcommands registered here. Consistent with existing src/cli/commands/ structure. | ✓ |
| src/index.ts | Top-level entry. Mixes CLI with library concerns if we ever export as a module. | |
| bin/sessionmem.ts | Dedicated bin directory. Separate from src, common npm CLI pattern. | |

**User's choice:** src/cli/index.ts

---

| Option | Description | Selected |
|--------|-------------|----------|
| stderr message + non-zero exit | Print human-readable error to stderr, exit(1). Standard Unix contract. | ✓ |
| stderr + JSON error object | Machine-readable. Good for scripting/piping. More complex to implement. | |
| You decide | Claude picks per-command based on context. | |

**User's choice:** stderr message + non-zero exit

---

## Install Health Check

| Option | Description | Selected |
|--------|-------------|----------|
| DB init + adapter config written | Confirm DB migrations ran and adapter config was written. Fast, no network. | ✓ |
| DB init + adapter config + MCP ping | Also launch MCP server briefly and test it responds. More thorough but slower and more fragile. | |
| Config written only | Don't validate DB. Simpler but misses silent DB init failures. | |

**User's choice:** DB init + adapter config written

---

| Option | Description | Selected |
|--------|-------------|----------|
| Step-by-step checklist | ✓ DB initialized / ✓ Config updated / ✓ sessionmem ready. Clear, actionable. | ✓ |
| Single success line | sessionmem installed for Claude Code. Minimal. Already what install.ts does. | |
| You decide | Claude picks based on what info is most useful. | |

**User's choice:** Step-by-step checklist

---

| Option | Description | Selected |
|--------|-------------|----------|
| Keep DB by default, --purge to delete | Matches CLI-02 requirement. Uninstall removes IDE configs/hooks. --purge to wipe memories. | ✓ |
| Always delete DB on uninstall | Simpler, but violates CLI-02 and destroys user data. | |
| Ask interactively at uninstall time | Interactive y/N prompt. Bad for scripted uninstalls. | |

**User's choice:** Keep DB by default, --purge to delete

---

## Data Command Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text table, no color | ID \| score \| date \| preview. Pipeable, no ANSI codes. | ✓ |
| Colorized table | Bold headers, dimmed metadata. Nicer but breaks pipe/grep and adds color dep. | |
| --json flag for machine-readable, plain text default | Best of both. More work to implement. | |

**User's choice:** Plain text table, no color

---

| Option | Description | Selected |
|--------|-------------|----------|
| All fields, plain text key: value | ID, content, importance, score, created_at, session_id, project_id, source_adapter. grep-friendly. | ✓ |
| JSON dump of memory record | Machine-readable, exact DB shape. Good for scripting. | |
| Formatted summary + raw JSON | Human section + raw JSON below. Verbose. | |

**User's choice:** All fields, plain text key: value

---

| Option | Description | Selected |
|--------|-------------|----------|
| --force flag required, otherwise dry-run | sessionmem forget <id> prints preview. --force to confirm. Prevents accidental deletion. | ✓ |
| Delete immediately, no confirmation | Fast, scriptable, but one typo = lost memory. No undo. | |
| Interactive y/N prompt | Friendly but breaks non-interactive/scripted use. | |

**User's choice:** --force flag required, otherwise dry-run

---

## Export/Import Format

| Option | Description | Selected |
|--------|-------------|----------|
| JSON array | [{id, content, importance, ...}, ...]. Human-readable, diffable, lossless. | ✓ |
| NDJSON | One record per line. Better for streaming. Overkill at this scale. | |
| SQLite dump | Exact byte copy. Lossless but opaque, not portable across schema versions. | |

**User's choice:** JSON array

---

| Option | Description | Selected |
|--------|-------------|----------|
| Skip duplicates | Skip silently. Print summary: 'Imported 42, skipped 3 duplicates.' Safe, idempotent. | |
| Overwrite duplicates | Replace existing records. Risky if accidentally re-importing old data. | |
| --merge flag: skip by default, overwrite with flag | Most flexible. Covers both use cases explicitly. | ✓ |

**User's choice:** --merge flag: skip by default, overwrite with flag

---

| Option | Description | Selected |
|--------|-------------|----------|
| Positional path arg | sessionmem export ./backup.json. Explicit, easy to script. | |
| Default filename, optional path | Defaults to ~/.sessionmem/export-{date}.json. User can override. Convenient, predictable location. | ✓ |
| stdout/stdin with --file flag | Unix-native but unfamiliar to non-CLI users. | |

**User's choice:** Default filename, optional path

---

## Claude's Discretion

None — user made explicit choices for all questions.

## Deferred Ideas

None — discussion stayed within phase scope.
