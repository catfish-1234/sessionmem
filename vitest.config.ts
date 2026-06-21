import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Windows CI runners are slow to spin up better-sqlite3 + run migrations
    // under parallel workers, which can exceed vitest's 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
    exclude: ["**/node_modules/**", "**/.claude/worktrees/**"],
  },
});
