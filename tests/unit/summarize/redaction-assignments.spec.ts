import { describe, expect, it } from "vitest";
import { applyRedaction } from "../../../src/core/summarize/redaction.js";

const redact = (input: string): string =>
  applyRedaction(input, { redactionEnabled: true }).text;

describe("secret-assignment redaction", () => {
  it("redacts colon-separated assignments (YAML, log lines)", () => {
    // `:` was not a recognized separator, so YAML config and `Header: value`
    // log lines leaked their values verbatim.
    const out = redact("aws_secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCY");
    expect(out).not.toContain("wJalrXUtnFEMI");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts keys carrying affixes", () => {
    // The keyword had to sit on a \b boundary and `_` is a word character, so
    // affixed names never matched.
    for (const line of [
      "SECRET_TOKEN_VALUE=deadbeefcafebabedeadbeef12345678",
      "MY_API_KEY_PROD=abcdefghijklmnop",
      "export DB_PASSWORD=SuperSecret123!",
    ]) {
      expect(redact(line)).toContain("[REDACTED]");
    }
  });

  it("redacts quoted values containing spaces", () => {
    // The old value class excluded quotes, so a quoted value matched nothing.
    expect(redact('password="my secret pw"')).toBe('password="[REDACTED]"');
    expect(redact("password='hunter2hunter2'")).toBe("password='[REDACTED]'");
  });

  it("redacts HTTP Basic auth and Slack webhooks", () => {
    expect(redact("Authorization: Basic dXNlcjpwYXNzd29yZDEyMwo=")).toContain(
      "[REDACTED_BASIC_AUTH]",
    );
    expect(
      redact("https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX"),
    ).toContain("[REDACTED_SLACK_WEBHOOK]");
  });

  it("keeps redacted JSON parseable, including escaped-quote values", () => {
    // session_events store JSON, so a secret inside a stringified field arrives
    // as `password=\"a b\"`. Matching the lone backslash as a bare value left
    // the rest of the quoted run stranded and corrupted the payload.
    const payload = JSON.stringify({
      tool: "Write",
      input: { content: 'password="pa ss"\napi_key: AKIAIOSFODNN7EXAMPLE' },
      nested: { client_secret: "abcdef123456" },
    });

    const out = redact(payload);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain("pa ss");
    expect(out).not.toContain("abcdef123456");
  });

  it("leaves ordinary prose and code alone", () => {
    for (const benign of [
      "The token bucket algorithm smooths bursty traffic.",
      "Use JWT tokens for auth; see docs/auth.md",
      "Edited src/core/injection/tokenBudget.ts",
      "score total=0.937, semantic=0.94, recency=0.95",
      "- [decision] Store secrets in a vault, never in the repo.",
    ]) {
      expect(redact(benign)).toBe(benign);
    }
  });

  it("stays linear on adversarial input (ReDoS guard)", () => {
    const hostile = `password=${"a".repeat(20_000)}${"!".repeat(5_000)}`;
    const started = Date.now();
    redact(hostile);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
