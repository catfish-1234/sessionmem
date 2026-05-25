import { describe, expect, it } from "vitest";

import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed";
import { shouldReembed } from "../../../src/core/embed/reembedPolicy";

describe("deterministicEmbed", () => {
  it("returns same vector for same input", () => {
    const first = deterministicEmbed("  Hello\tWorld  ", 8);
    const second = deterministicEmbed("hello world", 8);

    expect(first.vector).toEqual(second.vector);
  });

  it("returns vector with requested dimension", () => {
    const result = deterministicEmbed("dimension test", 12);
    expect(result.vector).toHaveLength(12);
  });

  it("shouldReembed returns false for same text and version", () => {
    expect(
      shouldReembed(
        {
          normalizedText: "same input",
          embeddingVersion: "v1-hash-local",
        },
        "same input",
        "v1-hash-local",
      ),
    ).toBe(false);
  });

  it("shouldReembed returns true on text change", () => {
    expect(
      shouldReembed(
        {
          normalizedText: "same input",
          embeddingVersion: "v1-hash-local",
        },
        "different input",
        "v1-hash-local",
      ),
    ).toBe(true);
  });

  it("shouldReembed returns true on version change", () => {
    expect(
      shouldReembed(
        {
          normalizedText: "same input",
          embeddingVersion: "v1-hash-local",
        },
        "same input",
        "v2-new-version",
      ),
    ).toBe(true);
  });
});
