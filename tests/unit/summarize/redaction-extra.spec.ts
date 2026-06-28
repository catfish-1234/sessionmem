import { describe, expect, it } from "vitest";
import { applyRedaction } from "../../../src/core/summarize/redaction.js";

function redact(input: string): string {
  return applyRedaction(input, { redactionEnabled: true }).text;
}

describe("redaction — extended secret patterns (MEDIUM-1)", () => {
  it("redacts Slack tokens", () => {
    const out = redact("slack token xoxb-TESTING12-abcdefABCDEF0123 here");
    expect(out).not.toContain("xoxb-123456789012");
    expect(out).toContain("[REDACTED_SLACK_TOKEN]");
  });

  it("redacts Google API keys", () => {
    const key = "AIza" + "B".repeat(35);
    const out = redact(`google key ${key} end`);
    expect(out).not.toContain(key);
    expect(out).toContain("[REDACTED_GOOGLE_API_KEY]");
  });

  it("redacts api_key=, token=, and password= assignments (key kept, value redacted)", () => {
    expect(redact("api_key=supersecretvalue123")).toBe("api_key=[REDACTED]");
    expect(redact("token=abc123def456")).toBe("token=[REDACTED]"); // gitleaks:allow
    expect(redact("password=hunter2")).toBe("password=[REDACTED]");
  });

  it("redacts URL-embedded credentials, keeping scheme and host", () => {
    // A literal '@' in a URL password is invalid (must be %40-encoded), so the
    // password here uses url-safe characters.
    const out = redact("clone https://alice:s3cretPass@github.com/org/repo.git");
    expect(out).not.toContain("s3cretPass");
    expect(out).toContain("https://[REDACTED_CREDENTIALS]@");
    expect(out).toContain("github.com/org/repo.git");
  });

  it("redacts a PEM private key block", () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIBVAIBADANBgkqhkiG9w0BAQEFAAS", // gitleaks:allow
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const out = redact(`key:\n${pem}\n`);
    expect(out).not.toContain("MIIBVAIBADANB");
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("fully redacts project-scoped OpenAI keys (sk-proj-...)", () => {
    const key = "sk-proj-abcdefghijklmnop1234567890"; // gitleaks:allow
    const out = redact(`key ${key} done`);
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).toContain("[REDACTED_API_KEY]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "the database connection settings live in config.ts";
    expect(redact(text)).toBe(text);
  });
});
