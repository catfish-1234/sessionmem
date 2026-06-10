import { describe, expect, it } from "vitest";
import { applyRedaction } from "../../../src/core/summarize/redaction.js";

// Test fixtures: concrete sample secrets are constructed here (in the test file)
// from the shapes described in the plan. They are NOT real credentials — they are
// canonical/docs-style example values built to exercise each redaction rule.
const AWS_KEY = `AKIA${"IOSFODNN7EXAMPLE".slice(0, 16)}`; // AKIA + 16 uppercase-alphanumerics
const GITHUB_TOKEN = `ghp_${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8".slice(0, 36)}`;
const GITHUB_OAUTH_TOKEN = `gho_${"A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8".slice(0, 36)}`;
// JWT: three base64url segments separated by dots, header begins with "eyJ".
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const PEM_BLOCK =
  "-----BEGIN RSA PRIVATE KEY-----\n" +
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q\n" +
  "uKUpRKfFLfRYC9AIKjbJTWit+Cqvjz0e0xZqVAgMBAAE=\n" +
  "-----END RSA PRIVATE KEY-----";

const ON = { redactionEnabled: true };

describe("defaultRules() expanded secret coverage", () => {
  it("redacts AWS access keys", () => {
    const out = applyRedaction(`key is ${AWS_KEY} ok`, ON).text;
    expect(out).toContain("[REDACTED_AWS_KEY]");
    expect(out).not.toContain(AWS_KEY);
  });

  it("redacts GitHub personal access tokens (ghp_)", () => {
    const out = applyRedaction(`token ${GITHUB_TOKEN}`, ON).text;
    expect(out).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(out).not.toContain(GITHUB_TOKEN);
  });

  it("redacts other GitHub token prefixes (gho_/ghu_/ghs_/ghr_)", () => {
    const out = applyRedaction(`token ${GITHUB_OAUTH_TOKEN}`, ON).text;
    expect(out).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(out).not.toContain(GITHUB_OAUTH_TOKEN);
  });

  it("redacts Bearer token header values (case-insensitive)", () => {
    const out = applyRedaction("Authorization: Bearer abc123def456ghi789", ON).text;
    expect(out).toContain("[REDACTED_BEARER_TOKEN]");
    expect(out).not.toContain("abc123def456ghi789");

    const lower = applyRedaction("authorization: bearer abc123def456ghi789", ON).text;
    expect(lower).toContain("[REDACTED_BEARER_TOKEN]");
    expect(lower).not.toContain("abc123def456ghi789");
  });

  it("redacts PEM private key blocks", () => {
    const out = applyRedaction(`my key:\n${PEM_BLOCK}\ndone`, ON).text;
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).not.toContain("MIIBOgIBAAJBAKj");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("redacts password= assignment values, keeping the key", () => {
    const out = applyRedaction("password=hunter2", ON).text;
    expect(out).toContain("password=");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("hunter2");
  });

  it("redacts secret= assignment values, keeping the key", () => {
    const out = applyRedaction("secret=topsecretvalue", ON).text;
    expect(out).toContain("secret=");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("topsecretvalue");
  });

  it("redacts JWTs", () => {
    const out = applyRedaction(`jwt ${JWT}`, ON).text;
    expect(out).toContain("[REDACTED_JWT]");
    expect(out).not.toContain(JWT);
  });

  it("preserves existing email and sk- API key redaction", () => {
    const out = applyRedaction("user@example.com sk-abcdefghijkl", ON).text;
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).not.toContain("user@example.com");
    expect(out).not.toContain("sk-abcdefghijkl");
  });

  it("returns ordinary prose byte-identical (no false positives)", () => {
    const prose = "the quick brown fox jumps over the lazy dog";
    expect(applyRedaction(prose, ON).text).toBe(prose);
  });

  it("does not redact ordinary words resembling token prefixes", () => {
    // 'password' alone with no assignment, plain words — must remain untouched
    const prose = "I forgot my password and the bearer of bad news arrived";
    expect(applyRedaction(prose, ON).text).toBe(prose);
  });

  it("bypasses all rules when redaction is disabled", () => {
    const combined = `${AWS_KEY} ${JWT} ${GITHUB_TOKEN} password=hunter2`;
    expect(applyRedaction(combined, { redactionEnabled: false }).text).toBe(combined);
  });

  it("redacts multiple secret categories in one input", () => {
    const input = `aws ${AWS_KEY} and jwt ${JWT} and gh ${GITHUB_TOKEN}`;
    const out = applyRedaction(input, ON).text;
    expect(out).toContain("[REDACTED_AWS_KEY]");
    expect(out).toContain("[REDACTED_JWT]");
    expect(out).toContain("[REDACTED_GITHUB_TOKEN]");
  });
});
