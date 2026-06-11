import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/troubleshooting.md.
 *
 * Not a prose-quality judge — it guards the troubleshooting doc against drifting
 * away from the three problem buckets: install failures, adapter issues, and
 * better-sqlite3 native-build symptoms.
 */
const DOC_PATH = join(process.cwd(), "docs", "troubleshooting.md");

describe("troubleshooting docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("covers install-failure and adapter topics", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "Install failures",
      "config.json",
      "adapter",
      "ping",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });

  it("covers better-sqlite3 native-build symptoms", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "better-sqlite3",
      "node-gyp",
      "ABI",
      "MSVC",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing native-build token: ${token}`).toContain(token);
    }
  });
});
