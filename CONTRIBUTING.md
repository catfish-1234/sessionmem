# Contributing to sessionmem

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting started

```bash
git clone https://github.com/catfish-1234/sessionmem.git
cd sessionmem
npm install
npm run build
```

### MCP config for local development

Copy `.mcp.json.example` to `.mcp.json` for local dev, or run `sessionmem install` to auto-configure. The `.mcp.json` file is gitignored because it contains machine-specific paths.

## Development workflow

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

### Benchmarks

```bash
npm run build        # benchmarks import from dist/
npm run benchmark    # regenerates docs/benchmark.md
```

All four checks (build, test, lint, typecheck) run in CI across Ubuntu, macOS, and Windows on Node 20 and 22.

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
- **No explicit `any` in tests**: the lint rule is relaxed in `tests/`.
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

If you find a security vulnerability, **do not open a public issue**. Instead, email kavishdua@gmail.com with details. See the [security workflow](.github/workflows/security.yml) for how automated scanning works.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
