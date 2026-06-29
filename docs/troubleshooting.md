# Troubleshooting

Common problems running `sessionmem` and how to fix them. Most issues fall into one of three buckets: install failures, adapter (MCP host) issues, and `better-sqlite3` native-build failures. Configuration lives in `~/.sessionmem/config.json`.

## Install failures

### `config.json` not written

`sessionmem install` only writes `~/.sessionmem/config.json` if it does not already exist. An existing config is preserved exactly as-is. If you expected fresh defaults but the file is unchanged, that is by design. Delete or move the old file and re-run `sessionmem install`, or edit it directly with `sessionmem config set`.

### Adapter not detected

`install` registers sessionmem with the MCP host in the current directory. If install reports that it could not find a host, you are likely running it outside a project the host recognizes. `cd` into your project root (where the host's config lives) and re-run `sessionmem install`. Run `sessionmem ping` afterward to confirm connectivity.

### Command not found

If `sessionmem` is not on your `PATH` after `npm install -g sessionmem`, your npm global bin directory is not on `PATH`. Add npm's global prefix `bin` to your shell `PATH`, or invoke via `npx sessionmem`.

## Adapter issues

Each MCP host is wired in through its own adapter. Symptoms here usually mean the host launched the server but the integration is misconfigured.

- **Claude Code**: if memories are not injected at session start, confirm `sessionmem install` was run inside the project and that the MCP server entry exists in the host config. Use `sessionmem ping` to verify the server is reachable.
- **Cursor**: Cursor must be pointed at the registered MCP server. Re-run `install` from the project root and restart Cursor so it reloads MCP servers.
- **Generic MCP host**: for any other MCP-compatible host, ensure the host is configured to launch `sessionmem run` as the MCP server command. If the host starts but no memory appears, check that the working directory matches the project whose memories you expect.

If a host loads but commands hang, run `sessionmem ping` to isolate whether the problem is the server or the host wiring.

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
