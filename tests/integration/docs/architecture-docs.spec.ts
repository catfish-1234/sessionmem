import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/architecture.md.
 *
 * Not a prose-quality judge — it guards the architecture overview against
 * drifting away from the four named subsystems and the retrieval/injection
 * flows. If a required subsystem token is removed, this spec fails.
 */
const DOC_PATH = join(process.cwd(), "docs", "architecture.md");

describe("architecture docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("names the four subsystems and the two flows", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "core engine",
      "adapter",
      "CLI",
      "SQLite",
      "retrieval",
      "injection",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });
});
