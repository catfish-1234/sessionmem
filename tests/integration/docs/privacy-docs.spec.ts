import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/privacy-and-retention.md.
 *
 * This is not a prose-quality judge — it guards the docs against drifting out of
 * sync with the shipped Phase 6 commands and config surface. If a documented
 * command token or required topic is removed from the doc, this spec fails.
 */
const DOC_PATH = join(process.cwd(), "docs", "privacy-and-retention.md");

describe("privacy-and-retention docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("covers the required config and retention topics", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "redactionEnabled",
      "retentionDays",
      "90",
      "config.json",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });

  it("documents the Phase 6 CLI command surface", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredCommands = [
      "retention prune",
      "redact-scan",
      "config set",
      "config get",
      "--force",
      "--apply",
    ];
    for (const token of requiredCommands) {
      expect(doc, `missing command token: ${token}`).toContain(token);
    }
  });

  it("names the redaction categories", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const categories = ["AWS", "GitHub", "JWT", "private key", "Bearer"];
    for (const token of categories) {
      expect(doc, `missing redaction category: ${token}`).toContain(token);
    }
  });
});
