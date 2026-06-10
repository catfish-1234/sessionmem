# Phase 06 Deferred Items

Out-of-scope discoveries logged during execution. Not fixed by the discovering plan.

## From 06-02 (retention prune core)

- **Pre-existing test failure (out of scope):** `tests/integration/cli/cli-entrypoint.spec.ts`
  fails with `Built CLI not found at .../dist/cli/index.js. Run "npm run build" before this spec.`
  This is an environmental/build-artifact issue (no `dist/` build present in a fresh
  worktree checkout), unrelated to plan 06-02's core changes. Resolve by running
  `npm run build` before the CLI integration suite, or gating that spec on a build step in CI.
