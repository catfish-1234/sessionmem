import { afterEach, describe, expect, it } from "vitest";

import { applyRedaction, customPatternError, setCustomRedactionPatterns } from "../../../src/core/summarize/redaction.js";

const redact = (text: string) => applyRedaction(text, { redactionEnabled: true }).text;

afterEach(() => { setCustomRedactionPatterns([]); });

describe("custom redaction patterns", () => {
  it("redacts an organisation's own token format with a named placeholder", () => {
    setCustomRedactionPatterns([{ name: "ACME_KEY", pattern: "acme_live_[A-Za-z0-9]{24}" }]);
    const key = "acme_live_" + "Zx9".repeat(8);
    expect(redact(`deploy with ${key} tonight`)).toBe("deploy with [REDACTED_ACME_KEY] tonight");
  });

  it("supports case-insensitive matching and runs ahead of the built-in rules", () => {
    setCustomRedactionPatterns([{ name: "BADGE_ID", pattern: "badge-\\d{6}", ignoreCase: true }]);
    expect(redact("Badge-123456 and BADGE-654321")).toBe("[REDACTED_BADGE_ID] and [REDACTED_BADGE_ID]");
  });

  it("skips an unusable entry without disabling the others", () => {
    const problems = setCustomRedactionPatterns([
      { name: "EMPTY", pattern: "x*" },
      { name: "GOOD", pattern: "corp-[0-9]{8}" },
    ]);
    expect(problems).toEqual(["EMPTY: pattern matches the empty string"]);
    expect(redact("id corp-12345678")).toBe("id [REDACTED_GOOD]");
  });

  it.each([
    [{ name: "lower", pattern: "abc" }, /name must be/],
    [{ name: "X", pattern: "(" }, /not a valid regular expression/],
    [{ name: "X", pattern: "a?" }, /empty string/],
    [{ name: "X", pattern: "(a+)+b" }, /backtrack/],
    [{ name: "X", pattern: "([a-z]*)*x" }, /backtrack/],
    [{ name: "X", pattern: "(?:ab{2,})+c" }, /backtrack/],
    [{ name: "X", pattern: "k".repeat(501) }, /1-500 characters/],
  ])("refuses %o", (entry, problem) => {
    expect(customPatternError(entry)).toMatch(problem);
  });

  it.each(["tok_[a-f0-9]{32}", "(?:acme|initech)_[A-Z]{4}-\\d{4}", "\\bSECRET-[0-9]+\\b"])("accepts %s", (pattern) => {
    expect(customPatternError({ name: "OK", pattern })).toBeUndefined();
  });

  it("returns to the built-in rules when the configured list is emptied", () => {
    setCustomRedactionPatterns([{ name: "ACME", pattern: "acme-[0-9]{4}" }]);
    setCustomRedactionPatterns([]);
    expect(redact("acme-1234")).toBe("acme-1234");
  });
});
