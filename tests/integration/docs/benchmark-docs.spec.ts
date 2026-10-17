import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("conversational benchmark documentation", () => {
  it("links the recorded report to the runnable methodology", () => {
    const report = readFileSync("docs/benchmark.md", "utf8");
    expect(report).toContain("../benchmarks/README.md");
    expect(report).toContain("npm run benchmark");
    for (const metric of ["Hit rate", "Precision", "Recall", "latency"]) expect(report).toContain(metric);
  });

  it("documents evidence scoring, public APIs, offline operation, and data license", () => {
    const doc = readFileSync("benchmarks/README.md", "utf8");
    for (const topic of ["storeMemory", "retrieveMemories", "CC BY-NC 4.0", "1,527", "459", "macro", "API keys", "--output"]) {
      expect(doc).toContain(topic);
    }
  });
});
