import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doc-presence smoke test for docs/benchmark.md (mirrors the D-09 template in
 * privacy-docs.spec.ts).
 *
 * This is not a prose-quality judge — it guards the generated benchmark report
 * against drifting out of sync with the benchmark script. The report is produced
 * by `npm run benchmark` (scripts/benchmark.mjs); if a measurement dimension or
 * its label is dropped from the generated output, this spec fails. The report
 * and this spec form a token contract: the headings/labels the script writes
 * must contain every token asserted here.
 */
const DOC_PATH = join(process.cwd(), "docs", "benchmark.md");

describe("benchmark.md docs coverage", () => {
  it("the benchmark.md report exists", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("reports the token-reduction dimension", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const tokens = ["token", "reduction", "Token reduction", "Baseline"];
    for (const token of tokens) {
      expect(doc, `missing token-reduction token: ${token}`).toContain(token);
    }
  });

  it("reports the retrieval-relevance dimension", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const tokens = ["relevance", "hit", "Hit-rate", "precision", "recall"];
    for (const token of tokens) {
      expect(doc, `missing relevance token: ${token}`).toContain(token);
    }
  });

  it("references the production functions the benchmark drives", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const tokens = [
      "retrieveMemories",
      "formatStartupInjection",
      "countTokens",
      "deterministicEmbed",
    ];
    for (const token of tokens) {
      expect(doc, `missing production-function reference: ${token}`).toContain(
        token,
      );
    }
  });

  it("documents how to reproduce the report", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    expect(doc).toContain("npm run benchmark");
  });
});
