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
    kind: overrides.kind ?? "decision",
    content: overrides.content ?? "decided to use X",
    normalized_content: overrides.normalized_content ?? "decided to use x",
    importance: overrides.importance ?? 5,
    author: overrides.author ?? "",
    origin_project_id: overrides.origin_project_id ?? null,
    created_at: overrides.created_at ?? "2026-05-25T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-25T00:00:00.000Z",
    embedding_dim: null,
    embedding_version: null,
    semantic: overrides.semantic ?? 0.5,
    score: overrides.score ?? {
      raw: { semantic: 0.5, recency: 0.75, importance: 0.5 },
      weighted: { semantic: 0.3, recency: 0.1875, importance: 0.075 },
      total,
    },
  };
}

describe("formatStartupInjection author annotation (D-10)", () => {
  it("prefixes teammate-authored content with the author name", () => {
    const output = formatStartupInjection(
      [memory({ author: "alice", content: "decided to use X" })],
      { localUsername: "bob" },
    );

    expect(output).toContain("- [decision] alice: decided to use X");
  });

  it("renders no prefix when the author equals the local user", () => {
    const output = formatStartupInjection(
      [memory({ author: "bob", content: "decided to use X" })],
      { localUsername: "bob" },
    );

    expect(output).toContain("- [decision] decided to use X");
    expect(output).not.toContain("bob: decided to use X");
  });

  it("renders no prefix when the author is empty (legacy/local rows)", () => {
    const output = formatStartupInjection(
      [memory({ author: "", content: "decided to use X" })],
      { localUsername: "bob" },
    );

    expect(output).toContain("- [decision] decided to use X");
    expect(output).not.toContain(": decided to use X");
  });

  it("never adds a prefix when localUsername is not provided", () => {
    const output = formatStartupInjection([
      memory({ author: "alice", content: "decided to use X" }),
    ]);

    expect(output).toContain("- [decision] decided to use X");
    expect(output).not.toContain("alice: decided to use X");
  });
});
