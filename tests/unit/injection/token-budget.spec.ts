import { describe, expect, it } from "vitest";

import {
  countTokens,
  trimLowestPriorityContent,
} from "../../../src/core/injection/tokenBudget.js";

describe("token budget helpers", () => {
  it("counts text tokens with the configured tokenizer", () => {
    expect(countTokens("short memory")).toBeGreaterThan(0);
    expect(countTokens("short memory plus additional retrieval context")).toBeGreaterThan(
      countTokens("short memory"),
    );
  });

  it("trims the lowest-priority non-preserved content first", () => {
    const included = [
      {
        id: "critical",
        content: "critical warning content must stay intact ".repeat(8),
        priority: 5,
        preserve: true,
      },
      {
        id: "preference",
        content: "low priority preference detail ".repeat(12),
        priority: 1,
      },
      {
        id: "decision",
        content: "higher priority decision detail ".repeat(12),
        priority: 4,
      },
    ];

    const trimmed = trimLowestPriorityContent(included, {
      minContentTokens: 10,
      trimRatio: 0.5,
    });

    expect(trimmed[0].content).toBe(included[0].content);
    expect(trimmed[1].content).toMatch(/\.\.\.$/);
    expect(trimmed[1].content.length).toBeLessThan(included[1].content.length);
    expect(trimmed[2].content).toBe(included[2].content);
  });

  it("returns entries unchanged when only preserved content remains trim-eligible", () => {
    const included = [
      {
        content: "critical warning content ".repeat(20),
        priority: 5,
        preserve: true,
      },
    ];

    expect(trimLowestPriorityContent(included)).toEqual(included);
  });
});
