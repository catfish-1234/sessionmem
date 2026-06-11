import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/team-mode.md.
 *
 * Not a prose-quality judge — it guards the doc against drifting out of sync
 * with the shipped Phase 7 team-mode command surface and the documented
 * behaviors (setup, sync, provenance, conflict handling, disable/recovery, and
 * the trust boundary). If a documented command token or required topic is
 * removed, this spec fails.
 */
const DOC_PATH = join(process.cwd(), "docs", "team-mode.md");

describe("team-mode docs coverage", () => {
  it("the doc file exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("documents the team-mode CLI command surface", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredCommands = [
      "team enable",
      "team disable",
      "--remove-team-memories",
      "sync",
    ];
    for (const token of requiredCommands) {
      expect(doc, `missing command token: ${token}`).toContain(token);
    }
  });

  it("documents provenance, conflict, shared-path, and trust-boundary topics", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const requiredTopics = [
      "author",
      "last-write-wins",
      "shared",
      "advisory",
    ];
    for (const token of requiredTopics) {
      expect(doc, `missing topic token: ${token}`).toContain(token);
    }
  });

  it("documents the D-16 sync summary string", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    expect(doc).toContain("Pushed N memories, pulled M new + updated K from teammates.");
  });
});
