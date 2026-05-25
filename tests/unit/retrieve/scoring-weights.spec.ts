import { describe, expect, it } from "vitest";

import { normalizeImportance } from "../../../src/core/retrieve/importance.js";
import { getRecencyBandScore } from "../../../src/core/retrieve/recencyBands.js";
import {
  SCORING_WEIGHTS,
  scoreMemoryCandidate,
} from "../../../src/core/retrieve/score.js";

describe("retrieval scoring primitives", () => {
  it("applies locked scoring weights", () => {
    expect(SCORING_WEIGHTS.semantic).toBe(0.60);
    expect(SCORING_WEIGHTS.recency).toBe(0.25);
    expect(SCORING_WEIGHTS.importance).toBe(0.15);
  });

  it("maps recency into bucketed scores", () => {
    const now = new Date("2026-05-25T12:00:00.000Z");

    expect(getRecencyBandScore("2026-05-25T00:00:00.000Z", now)).toBe(1.0);
    expect(getRecencyBandScore("2026-05-19T12:00:00.000Z", now)).toBe(0.75);
    expect(getRecencyBandScore("2026-05-01T12:00:00.000Z", now)).toBe(0.5);
    expect(getRecencyBandScore("2026-03-01T12:00:00.000Z", now)).toBe(0.25);
  });

  it("normalizes importance from 1..10 into 0..1", () => {
    expect(normalizeImportance(1)).toBe(0);
    expect(normalizeImportance(10)).toBe(1);
    expect(normalizeImportance(5.5)).toBeCloseTo(0.5, 5);
  });

  it("returns detailed weighted score parts for debugging", () => {
    const now = new Date("2026-05-25T12:00:00.000Z");

    const score = scoreMemoryCandidate(
      {
        semantic: 0.8,
        updated_at: "2026-05-25T09:00:00.000Z",
        importance: 10,
      },
      now,
    );

    expect(score.raw.recency).toBe(1.0);
    expect(score.raw.importance).toBe(1);
    expect(score.weighted.semantic).toBeCloseTo(0.48, 5);
    expect(score.weighted.recency).toBeCloseTo(0.25, 5);
    expect(score.weighted.importance).toBeCloseTo(0.15, 5);
    expect(score.total).toBeCloseTo(0.88, 5);
  });
});
