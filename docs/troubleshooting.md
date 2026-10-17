# Troubleshooting

This guide covers install failures, adapter (MCP host) issues, and `better-sqlite3` native-build failures. Configuration lives in `~/.sessionmem/config.json`.

## Install failures

### `config.json` not written

`sessionmem install` creates `~/.sessionmem/config.json` only if the file is missing. It leaves an existing config unchanged. To restore defaults, move or delete the old file and re-run `sessionmem install`. To change individual settings, use `sessionmem config set`.

### Adapter not detected

`install` registers sessionmem with the MCP host in the current directory. If install reports that it could not find a host, you are likely running it outside a project the host recognizes. `cd` into your project root (where the host's config lives) and re-run `sessionmem install`. Use `sessionmem install --adapter <name>` from a plain terminal (for example `--adapter cline` or `--adapter windsurf`, which cannot be reliably auto-detected). Run `sessionmem ping` afterward to check local database access; it does not probe the host's MCP connection.

### Command not found

If `sessionmem` is not on your `PATH` after `npm install -g sessionmem`, your npm global bin directory is not on `PATH`. Add npm's global prefix `bin` to your shell `PATH`, or invoke via `npx sessionmem`.

## Adapter issues

Each MCP host uses its own adapter. If the server starts but memories are missing, check the host's configuration:

- **Claude Code**: if memories are not injected at session start, confirm `sessionmem install` was run inside the project and that the MCP server entry exists in the host config. Use `sessionmem ping` to verify local database access, then check MCP connectivity in the host.
- **Cursor**: Cursor must be pointed at the registered MCP server. Re-run `install` from the project root and restart Cursor so it reloads MCP servers.
- **Generic MCP host**: for any other MCP-compatible host, ensure the host is configured to launch `sessionmem run` as the MCP server command. If the host starts but no memory appears, check that the working directory matches the project whose memories you expect.

If commands hang after the host loads, run `sessionmem ping` to check local database access, then check the host's MCP connection.

## "0 sessions" / no session data recorded

If `sessionmem savings` reports no session data or `sessionmem stats` shows `sessions: 0`, check the following.

### The hooks are not installed

Session events are captured by a `PostToolUse` hook that `sessionmem install` registers in `~/.claude/settings.json`. If you installed sessionmem before the auto-ingest hook existed, that hook is missing. Re-run `sessionmem install` (it is idempotent) and restart your editor, then confirm the entry exists:

```bash
sessionmem install
sessionmem stats   # check the session_events counter after a few tool calls
```

To watch the hook work in real time, run your host with `SESSIONMEM_DEBUG=1`; the hook then reports each ingest to stderr, including the project id it wrote to.

### Memory is keyed to the repository

A project's memories are keyed by its **repository root**, the nearest directory containing `.git`. All subdirectories in one repository share the same memory bucket.

Outside a repository, the id falls back to the exact working directory. Two different directories that are not in a repository are two different projects, so running `sessionmem stats` from a different folder than the one your host session used will show an empty store. Either run from inside the repository, or pin the id explicitly:

```bash
export SESSIONMEM_PROJECT_ID=my-project
```

Use `sessionmem browse` to list every project that has memories along with its id; the current project is marked.

### Not enough events to summarize

`handleSessionEnd` only writes a session summary once at least 3 events were captured. A very short session is skipped by design and reports `not enough session events to summarize`.

## `better-sqlite3` native-build failures

`sessionmem` stores memories in SQLite via `better-sqlite3`, which is a **native** module compiled for your platform and Node version. Most install-time crashes come from this native build.

### node-gyp build errors

If `npm install` fails compiling `better-sqlite3` with `node-gyp` errors, your toolchain is incomplete:

- **Windows**: install the Visual Studio Build Tools (MSVC C++ workload). `node-gyp` needs an MSVC compiler; without it the native build fails.
- **macOS**: install the Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: install `build-essential` (or your distro's equivalent: a C/C++ compiler, `make`, and `python3`).

### ABI mismatch (Node 20 vs 22)

`better-sqlite3` is compiled against a specific Node ABI. If you switch Node versions (for example from Node 20 to Node 22), a prebuilt or previously compiled binary can fail to load with a module-version / ABI mismatch error. Rebuild the native module against your current Node by reinstalling, or run `npm rebuild better-sqlite3`. If you use a Node version manager, make sure you reinstall after switching versions.

### Confirming the build

After a successful build, `sessionmem stats` (or any command that touches the database) will run without a native-load error. A native-build failure typically surfaces immediately as a "cannot find module" or "was compiled against a different Node.js version" error the first time the database is opened.
