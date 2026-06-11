import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/migration.md.
 *
 * Not a prose-quality judge — it guards the migration doc against drifting away
 * from its two D-08 halves: (a) the SQLite migration system (copy-migrations
 * build step + migrations dir) and (b) the version-upgrade policy.
 */
const DOC_PATH = join(process.cwd(), "docs", "migration.md");

describe("migration docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("documents the migration system (half a)", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "copy-migrations",
      "migrations",
      "dist",
      "src/core/schema/migrations",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing migration-system token: ${token}`).toContain(token);
    }
  });

  it("documents the version-upgrade policy (half b)", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "upgrade",
      "version",
      "semver",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing upgrade-policy token: ${token}`).toContain(token);
    }
  });
});
