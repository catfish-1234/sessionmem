# Contributing to sessionmem

To work on sessionmem, clone the repository, install dependencies, and build it using the commands below.

## Getting started

```bash
git clone https://github.com/catfish-1234/sessionmem.git
cd sessionmem
npm ci
npm run build
```

### MCP config for local development

Copy `.mcp.json.example` to `.mcp.json` and replace its example path with the
absolute path to this checkout’s `dist/cli/index.js`. Rebuild after source changes.
`sessionmem install` registers the executable on PATH, which may be a different
installed version. The `.mcp.json` file is gitignored because it contains machine-specific paths.

## Development workflow

Use Node 22.13 or newer (Node 24 LTS recommended). Node 20 reached end of life
on 2026-04-30 and is no longer supported; Commander 15, better-sqlite3 13 and
Vitest 5 all require Node 22.

### Build

```bash
npm run build        # compile TypeScript + copy migrations
```

### Test

```bash
npm test             # run all tests (Vitest)
npm run test:schema  # run schema/migration tests only
```

### Lint and typecheck

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

See [TypeScript 7 upgrade status](docs/typescript-upgrade.md) for the current
upstream tooling blocker and the criteria for removing the temporary Dependabot ignore.

### Benchmarks

```bash
npm run build        # benchmarks import from dist/
npm run benchmark    # regenerates docs/benchmark.md
```

All four checks (build, test, lint, typecheck) run in CI on Node 22, 24 and 26
for Ubuntu and macOS, and Node 24 for Windows. CI also installs the npm tarball and
checks the installed CLI. Run `npm pack --dry-run` to review published files;
only compiled runtime files, migrations, and user documentation belong there.

## Project structure

```
src/
  core/       # Memory engine: storage, retrieval, ranking, summarization
  adapters/   # MCP adapter layer (translates between MCP protocol and core)
  cli/        # CLI commands (sessionmem install, search, etc.)
tests/        # Vitest test suite
scripts/      # Build helpers and benchmark runner
docs/         # Architecture, benchmarks, and feature docs
```

## Code conventions

- **TypeScript**: strict mode, ES2022 target, NodeNext module resolution.
- **Unused vars**: prefix with underscore (`_unused`) to satisfy the lint rule.
- **Explicit `any` in tests**: permitted in `tests/`; source code keeps the lint rule.
- **Comments**: only when the "why" isn't obvious. No doc-block boilerplate.

## Pre-commit hooks

A [gitleaks](https://github.com/gitleaks/gitleaks) pre-commit hook runs automatically to prevent accidental secret commits. Install it with:

```bash
pip install pre-commit
pre-commit install
```

## Submitting changes

1. **Fork and branch**: create a feature branch from `main`.
2. **Keep PRs focused**: one feature or fix per PR.
3. **All checks must pass**: build, test, lint, and typecheck.
4. **Write tests** for new functionality or bug fixes.
5. **Update docs** if your change affects user-facing behavior or CLI commands.

### Commit messages

Use clear, descriptive commit messages. [Conventional Commits](https://www.conventionalcommits.org/) style is preferred:

```
feat: add memory export filtering by date range
fix: handle empty project ID in search query
docs: clarify team mode trust model
chore: bump better-sqlite3 to v12.5
```

## Reporting bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Node version, OS, and which MCP host you're using (Claude Code, Cursor, etc.)

## Feature requests

Open an issue describing the use case. Explain the problem you're trying to solve, not just the solution you have in mind.

## Security

If you find a security vulnerability, **do not open a public issue**. Use [GitHub private vulnerability reporting](https://github.com/catfish-1234/sessionmem/security/advisories/new). See the [security policy](SECURITY.md) for supported versions and response expectations, and the [security workflow](https://github.com/catfish-1234/sessionmem/blob/main/.github/workflows/security.yml) for automated scanning.

## Releasing

1. Add the version's section to `CHANGELOG.md` and run `npm version <x.y.z> --no-git-tag-version`,
   which also updates `package/package.json`, `.claude-plugin/plugin.json`, `server.json` and the
   Dockerfile pin.
2. Commit and push to `main`, then:

   ```bash
   npm run release -- --dry-run   # see what would be tagged
   npm run release                # tag the version and push it
   ```

`npm run release` refuses unless `main` is clean and identical to `origin/main`, and, with the
GitHub CLI signed in, unless CI is green on the commit it tags. It tags the version at HEAD, or at
the commit that introduced it while `CHANGELOG.md` still has unreleased entries. Pushing the tag
runs `.github/workflows/release.yml`, which builds, tests, publishes to npm and creates the GitHub
release with that version's CHANGELOG section as notes.

`npm run release -- --backfill` also tags older CHANGELOG versions that never got a tag. A tag runs
the release workflow of the commit it points at, and older workflows publish with npm's `latest`
dist-tag, so the older tags are pushed first, one at a time, and the current version only after
their runs finish. Without the GitHub CLI it pushes the older tags and stops; run `npm run release`
again once those runs are done. The current workflow publishes an older version under `legacy`
and marks only the newest version as the latest release, so that ordering only matters for
commits from before this workflow.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
