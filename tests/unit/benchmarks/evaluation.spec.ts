import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregate, captureConversation, prepareCorpus, scoreQuestion } from "../../../benchmarks/lib/evaluation.mjs";

describe("LoCoMo evidence evaluation", () => {
  it("counts partial multi-turn evidence, misses, empty results, and duplicates", () => {
    expect(scoreQuestion(["a", "b"], ["a", "noise"])).toEqual({
      hits: ["a"], hit: true, all_evidence: false, precision: 0.5, recall: 0.5,
    });
    expect(scoreQuestion(["a", "a"], ["a", "a"])).toMatchObject({ precision: 1, recall: 1, all_evidence: true });
    expect(scoreQuestion(["a"], ["noise"])).toMatchObject({ hit: false, precision: 0, recall: 0 });
    expect(scoreQuestion(["a"], [])).toMatchObject({ hit: false, precision: 0, recall: 0 });
    expect(() => scoreQuestion([], [])).toThrow("without evidence");
  });

  it("averages per question and uses the nearest-rank p95", () => {
    const rows = [
      { ...scoreQuestion(["a", "b"], ["a", "x"]), latency_ms: 2 },
      { ...scoreQuestion(["c"], []), latency_ms: 8 },
    ];
    expect(aggregate(rows)).toEqual({
      questions: 2, hit_rate: 0.5, precision: 0.25, recall: 0.25, all_evidence_rate: 0,
      latency_ms: { mean: 5, median: 5, p95: 8, max: 8 },
    });
    expect(() => aggregate([])).toThrow("No eligible questions");
  });

  it("verifies the committed corpus and accounts for every upstream question", () => {
    const provenance = JSON.parse(readFileSync("benchmarks/data/provenance.json", "utf8"));
    const raw = readFileSync("benchmarks/data/locomo10.json");
    expect(createHash("sha256").update(raw).digest("hex")).toBe(provenance.sha256);
    expect(createHash("sha256").update(readFileSync("benchmarks/data/LICENSE.txt")).digest("hex")).toBe(provenance.license_sha256);
    const corpus = prepareCorpus(JSON.parse(raw.toString()));
    const questions = corpus.flatMap((c) => c.questions);
    expect(corpus).toHaveLength(10);
    expect(corpus.flatMap((c) => c.sessions)).toHaveLength(272);
    expect(corpus.flatMap((c) => c.sessions.flatMap((s) => s.turns))).toHaveLength(5882);
    expect(questions).toHaveLength(1986);
    expect(questions.filter((q) => !q.excluded)).toHaveLength(1527);
    expect(questions.filter((q) => q.excluded === "adversarial")).toHaveLength(446);
    expect(questions.filter((q) => q.excluded === "missing_evidence")).toHaveLength(4);
    expect(questions.filter((q) => q.excluded === "invalid_evidence")).toHaveLength(9);
  });

  it("holds out answers and generated observations during public API capture", async () => {
    const corpus = prepareCorpus([{
      sample_id: "sample", observation: "HIDDEN OBSERVATION", session_summary: "HIDDEN SUMMARY",
      conversation: {
        session_2_date_time: "2 May 2023", session_2: [{ dia_id: "D2:1", speaker: "Lee", text: "Second visit" }],
        session_1_date_time: "1 May 2023", session_1: [{ dia_id: "D1:1", speaker: "Jo", text: "First visit", blip_caption: "a garden", img_url: "https://example.invalid/image" }],
      },
      qa: [
        { question: "HIDDEN QUESTION", answer: "HIDDEN ANSWER", evidence: ["D1:1"], category: 4 },
        { question: "Invalid", answer: "answer", evidence: ["D1:1", "D999:1"], category: 1 },
      ],
    }])[0];
    expect(corpus.questions[1].excluded).toBe("invalid_evidence");
    const captured: any[] = [];
    await captureConversation({ storeMemory: async (request) => { captured.push(request); return { ok: true }; } }, corpus);
    expect(captured.map((c) => c.memoryId)).toEqual(["sample/D1:1", "sample/D2:1"]);
    expect(captured[0].content).toBe("1 May 2023\nJo: First visit\nImage caption: a garden");
    expect(JSON.stringify(captured)).not.toMatch(/HIDDEN|https:/);
    await expect(captureConversation({ storeMemory: async () => ({ ok: false, error: "broken" }) }, corpus)).rejects.toThrow("Capture failed");
  });
});
