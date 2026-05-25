import { describe, expect, it } from "vitest";

import { deterministicEmbed } from "../../../src/core/embed/deterministicEmbed";

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
});
