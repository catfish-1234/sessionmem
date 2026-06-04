import { describe, expect, it } from "vitest";

import { formatStartupInjection } from "../../../src/core/injection/formatStartupInjection.js";
import { countTokens } from "../../../src/core/injection/tokenBudget.js";
import type { RetrievedMemoryCandidate } from "../../../src/core/retrieve/retrieveMemories.js";

function memory(
  overrides: Partial<RetrievedMemoryCandidate>,
): RetrievedMemoryCandidate {
  const total = overrides.score?.total ?? 0.5;
  const semantic = overrides.score?.raw.semantic ?? overrides.semantic ?? 0.5;

  return {
    id: overrides.id ?? "mem",
    project_id: overrides.project_id ?? "sessionmem",
    session_id: overrides.session_id ?? "coding-session",
    source_adapter: overrides.source_adapter ?? "codex",
    kind: overrides.kind ?? "fact",
    content: overrides.content ?? "Default memory content",
    normalized_content:
      overrides.normalized_content ?? overrides.content?.toLowerCase() ?? "default memory content",
    importance: overrides.importance ?? 5,
    created_at: overrides.created_at ?? "2026-06-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-06-01T00:00:00.000Z",
    embedding_dim: null,
    embedding_version: null,
    semantic,
    score: overrides.score ?? {
      raw: {
        semantic,
        recency: 0.75,
        importance: 0.5,
      },
      weighted: {
        semantic: semantic * 0.6,
        recency: 0.1875,
        importance: 0.075,
      },
      total,
    },
  };
}

function codingSessionFixtures(): RetrievedMemoryCandidate[] {
  return [
    memory({
      id: "decision-local-only",
      kind: "decision",
      content:
        "Use local-only defaults for summarization and retrieval unless a provider is explicitly enabled by the user.",
      importance: 9,
      updated_at: "2026-06-02T17:00:00.000Z",
      score: {
        raw: { semantic: 0.94, recency: 0.95, importance: 0.9 },
        weighted: { semantic: 0.564, recency: 0.2375, importance: 0.135 },
        total: 0.9365,
      },
    }),
    memory({
      id: "warning-no-secrets",
      kind: "warning",
      content:
        "Never send API keys, tokens, or other secrets to cloud summarization; redact or keep the entire path local.",
      importance: 10,
      updated_at: "2026-06-02T18:00:00.000Z",
      score: {
        raw: { semantic: 0.92, recency: 1, importance: 1 },
        weighted: { semantic: 0.552, recency: 0.25, importance: 0.15 },
        total: 0.952,
      },
    }),
    memory({
      id: "fact-scoring-weights",
      kind: "fact",
      content:
        "Retrieval scoring weights are semantic 0.60, recency 0.25, and importance 0.15 for ranked memory candidates.",
      importance: 8,
      updated_at: "2026-06-02T16:00:00.000Z",
      score: {
        raw: { semantic: 0.9, recency: 0.9, importance: 0.8 },
        weighted: { semantic: 0.54, recency: 0.225, importance: 0.12 },
        total: 0.885,
      },
    }),
    memory({
      id: "summary-session-flow",
      kind: "summary",
      content:
        "Session-end lifecycle orchestration runs threshold-gated summarization with retry handling and fallback behavior.",
      importance: 7,
      updated_at: "2026-06-02T15:00:00.000Z",
      score: {
        raw: { semantic: 0.82, recency: 0.85, importance: 0.7 },
        weighted: { semantic: 0.492, recency: 0.2125, importance: 0.105 },
        total: 0.8095,
      },
    }),
    memory({
      id: "preference-compact",
      kind: "preference",
      content:
        "Prefer compact implementation notes with concrete file references and no broad refactors outside the active plan.",
      importance: 6,
      updated_at: "2026-06-01T22:00:00.000Z",
      score: {
        raw: { semantic: 0.78, recency: 0.75, importance: 0.6 },
        weighted: { semantic: 0.468, recency: 0.1875, importance: 0.09 },
        total: 0.7455,
      },
    }),
  ];
}

function syntheticEdgeFixtures(): RetrievedMemoryCandidate[] {
  return [
    memory({
      id: "critical-warning",
      kind: "warning",
      content:
        "Critical warning must remain visible when the startup injection is over budget because it protects user secrets and irreversible operations. ".repeat(3),
      importance: 10,
      updated_at: "2026-06-03T00:00:00.000Z",
      score: {
        raw: { semantic: 0.88, recency: 1, importance: 1 },
        weighted: { semantic: 0.528, recency: 0.25, importance: 0.15 },
        total: 0.928,
      },
    }),
    memory({
      id: "normal-warning",
      kind: "warning",
      content: "Ordinary warning with lower importance can be dropped after trimming.",
      importance: 6,
      updated_at: "2026-06-02T23:00:00.000Z",
      score: {
        raw: { semantic: 0.7, recency: 0.95, importance: 0.6 },
        weighted: { semantic: 0.42, recency: 0.2375, importance: 0.09 },
        total: 0.7475,
      },
    }),
    memory({
      id: "long-preference",
      kind: "preference",
      content:
        "Preference detail is useful but expendable under tight startup injection limits and should be trimmed before stronger kinds disappear. ".repeat(14),
      importance: 6,
      updated_at: "2026-06-02T22:00:00.000Z",
      score: {
        raw: { semantic: 0.86, recency: 0.9, importance: 0.6 },
        weighted: { semantic: 0.516, recency: 0.225, importance: 0.09 },
        total: 0.831,
      },
    }),
    memory({
      id: "long-summary",
      kind: "summary",
      content:
        "Summary detail repeats the previous session transcript, open implementation notes, test command history, and follow-up reminders. ".repeat(16),
      importance: 5,
      updated_at: "2026-06-02T21:00:00.000Z",
      score: {
        raw: { semantic: 0.8, recency: 0.85, importance: 0.5 },
        weighted: { semantic: 0.48, recency: 0.2125, importance: 0.075 },
        total: 0.7675,
      },
    }),
  ];
}

function lineIndex(output: string, text: string): number {
  return output.split("\n").findIndex((line) => line.includes(text));
}

describe("startup injection quality harness", () => {
  it("keeps the relevant coding-session memories within the default token budget", () => {
    const output = formatStartupInjection(codingSessionFixtures());

    expect(countTokens(output)).toBeLessThanOrEqual(450);
    expect(output).toContain("Never send API keys, tokens, or other secrets");
    expect(output).toContain("Use local-only defaults for summarization and retrieval");
    expect(output).toContain("Retrieval scoring weights are semantic 0.60");
    expect(lineIndex(output, "[warning]")).toBeLessThan(lineIndex(output, "[decision]"));
    expect(lineIndex(output, "[decision]")).toBeLessThan(lineIndex(output, "[fact]"));
    expect(output).toMatchInlineSnapshot(`
      "Relevant prior context
      - [warning] Never send API keys, tokens, or other secrets to cloud summarization; redact or keep the entire path local. (score total=0.952, semantic=0.920, recency=1.000, importance=1.000; source=codex; date=2026-06-02T18:00:00.000Z)
      - [decision] Use local-only defaults for summarization and retrieval unless a provider is explicitly enabled by the user. (score total=0.936, semantic=0.940, recency=0.950, importance=0.900; source=codex; date=2026-06-02T17:00:00.000Z)
      - [fact] Retrieval scoring weights are semantic 0.60, recency 0.25, and importance 0.15 for ranked memory candidates. (score total=0.885, semantic=0.900, recency=0.900, importance=0.800; source=codex; date=2026-06-02T16:00:00.000Z)
      - [summary] Session-end lifecycle orchestration runs threshold-gated summarization with retry handling and fallback behavior. (score total=0.809, semantic=0.820, recency=0.850, importance=0.700; source=codex; date=2026-06-02T15:00:00.000Z)
      - [preference] Prefer compact implementation notes with concrete file references and no broad refactors outside the active plan. (score total=0.746, semantic=0.780, recency=0.750, importance=0.600; source=codex; date=2026-06-01T22:00:00.000Z)"
    `);
  });

  it("budgets synthetic edge fixtures deterministically without losing critical warnings", () => {
    const output = formatStartupInjection(syntheticEdgeFixtures(), { tokenCap: 220 });
    const repeatedOutput = formatStartupInjection(syntheticEdgeFixtures(), { tokenCap: 220 });

    expect(output).toBe(repeatedOutput);
    expect(countTokens(output)).toBeLessThanOrEqual(220);
    expect(output).toContain("[warning] Critical warning must remain visible");
    expect(output).toContain("[warning] Ordinary warning with lower importance");
    expect(output).not.toContain("[preference]");
    expect(output).not.toContain("[summary]");
    expect(output).toMatchInlineSnapshot(`
      "Relevant prior context
      - [warning] Critical warning must remain visible when the startup injection is over budget because it protects user secrets and irreversible operations. Critical warning must remain visible when the startup injection is over budget because it protects user secrets and irreversible operations. Critical warning must remain visible when the startup injection is over budget because it protects user secrets and irreversible operations.  (score total=0.928, semantic=0.880, recency=1.000, importance=1.000; source=codex; date=2026-06-03T00:00:00.000Z)
      - [warning] Ordinary warning with lower importance can be dropped after trimming. (score total=0.748, semantic=0.700, recency=0.950, importance=0.600; source=codex; date=2026-06-02T23:00:00.000Z)"
    `);
  });
});
