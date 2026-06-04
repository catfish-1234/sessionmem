import { describe, expect, it } from "vitest";

import { formatStartupInjection } from "../../../src/core/injection/formatStartupInjection.js";
import type { RetrievedMemoryCandidate } from "../../../src/core/retrieve/retrieveMemories.js";

function memory(
  overrides: Partial<RetrievedMemoryCandidate>,
): RetrievedMemoryCandidate {
  const total = overrides.score?.total ?? 0.5;

  return {
    id: overrides.id ?? "mem",
    project_id: "project",
    session_id: "session",
    source_adapter: overrides.source_adapter ?? "codex",
    kind: overrides.kind ?? "fact",
    content: overrides.content ?? "Default memory content",
    normalized_content: overrides.normalized_content ?? "default memory content",
    importance: overrides.importance ?? 5,
    created_at: overrides.created_at ?? "2026-05-25T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-25T00:00:00.000Z",
    embedding_dim: null,
    embedding_version: null,
    semantic: overrides.semantic ?? 0.5,
    score: overrides.score ?? {
      raw: {
        semantic: 0.5,
        recency: 0.75,
        importance: 0.5,
      },
      weighted: {
        semantic: 0.3,
        recency: 0.1875,
        importance: 0.075,
      },
      total,
    },
  };
}

describe("formatStartupInjection", () => {
  it("generates deterministic grouped output", () => {
    const output = formatStartupInjection([
      memory({
        id: "pref-1",
        kind: "preference",
        content: "Prefer compact implementation notes.",
        source_adapter: "claude",
        updated_at: "2026-05-23T08:00:00.000Z",
        score: {
          raw: { semantic: 0.4, recency: 0.5, importance: 0.8 },
          weighted: { semantic: 0.24, recency: 0.125, importance: 0.12 },
          total: 0.485,
        },
      }),
      memory({
        id: "warn-1",
        kind: "warning",
        content: "Never send secrets to cloud summarization.",
        source_adapter: "codex",
        updated_at: "2026-05-25T12:00:00.000Z",
        importance: 10,
        score: {
          raw: { semantic: 0.7, recency: 1, importance: 1 },
          weighted: { semantic: 0.42, recency: 0.25, importance: 0.15 },
          total: 0.82,
        },
      }),
      memory({
        id: "decision-1",
        kind: "decision",
        content: "Use local-only defaults unless a provider is explicitly enabled.",
        source_adapter: "codex",
        updated_at: "2026-05-24T12:00:00.000Z",
        score: {
          raw: { semantic: 0.8, recency: 0.75, importance: 0.9 },
          weighted: { semantic: 0.48, recency: 0.1875, importance: 0.135 },
          total: 0.8025,
        },
      }),
    ]);

    expect(output).toMatchInlineSnapshot(`
      "Relevant prior context
      - [warning] Never send secrets to cloud summarization. (score total=0.820, semantic=0.700, recency=1.000, importance=1.000; source=codex; date=2026-05-25T12:00:00.000Z)
      - [decision] Use local-only defaults unless a provider is explicitly enabled. (score total=0.802, semantic=0.800, recency=0.750, importance=0.900; source=codex; date=2026-05-24T12:00:00.000Z)
      - [preference] Prefer compact implementation notes. (score total=0.485, semantic=0.400, recency=0.500, importance=0.800; source=claude; date=2026-05-23T08:00:00.000Z)"
    `);
  });

  it("drops lower-priority non-warning entries before critical warnings", () => {
    const output = formatStartupInjection(
      [
        memory({
          id: "critical-warning",
          kind: "warning",
          content: "Critical warning must survive even under tiny token caps. ".repeat(8),
          importance: 10,
        }),
        memory({
          id: "preference",
          kind: "preference",
          content: "Preference detail can be removed first. ".repeat(20),
        }),
        memory({
          id: "summary",
          kind: "summary",
          content: "Summary detail can also be removed. ".repeat(20),
        }),
      ],
      { tokenCap: 35 },
    );

    expect(output).toContain("[warning]");
    expect(output).toContain("Critical warning must survive");
    expect(output).not.toContain("[preference]");
    expect(output).not.toContain("[summary]");
  });
});
