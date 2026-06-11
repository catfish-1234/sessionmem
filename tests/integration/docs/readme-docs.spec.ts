import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for the top-level README.md.
 *
 * Not a prose-quality judge — it guards the README against drifting out of sync
 * with the shipped CLI surface and the docs/ layout. The README lives at the
 * repo ROOT (not docs/), so this spec reads it from process.cwd().
 */
const DOC_PATH = join(process.cwd(), "README.md");

describe("README docs coverage", () => {
  it("the README exists at the repo root", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("documents the quickstart command surface", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTokens = [
      "Quickstart",
      "sessionmem install",
      "sessionmem run",
      "npm install",
    ];
    for (const token of requiredTokens) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });

  it("links into the docs/ set", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredLinks = [
      "docs/architecture.md",
      "docs/troubleshooting.md",
      "docs/migration.md",
    ];
    for (const token of requiredLinks) {
      expect(doc, `missing doc link: ${token}`).toContain(token);
    }
  });
});
