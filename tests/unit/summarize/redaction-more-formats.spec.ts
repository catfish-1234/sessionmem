import { describe, expect, it } from "vitest";

import { applyRedaction } from "../../../src/core/summarize/redaction.js";

const redact = (text: string) => applyRedaction(text, { redactionEnabled: true }).text;

// Synthetic values in each format's published shape, built by concatenation so no complete
// token appears in the source for a secret scanner to flag.
const B64_LINE = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7" + "x9Qz".repeat(2);

const TOKENS: Array<[string, string, string]> = [
  ["Stripe test secret key", "sk_" + "test_" + "4eC39HqLyjWDarjtT1zdp7dc", "[REDACTED_STRIPE_KEY]"],
  ["Stripe test restricted key", "rk_" + "test_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3", "[REDACTED_STRIPE_KEY]"],
  ["Stripe webhook secret", "whsec_" + "Zx81".repeat(8), "[REDACTED_STRIPE_KEY]"],
  ["Google OAuth access token", "ya29." + "a0AfB_byC1".repeat(8), "[REDACTED_GOOGLE_OAUTH_TOKEN]"],
  ["Google OAuth refresh token", "1//0" + "gAbC-dEfG_hIjK".repeat(4), "[REDACTED_GOOGLE_OAUTH_TOKEN]"],
  ["Google OAuth client secret", "GOCSPX-" + "Ab1_Cd2-Ef3G".repeat(2) + "Hi4J", "[REDACTED_GOOGLE_CLIENT_SECRET]"],
  ["Groq key", "gsk_" + "W8kP2xQ9".repeat(6) + "Ab3D", "[REDACTED_GROQ_KEY]"],
  ["xAI key", "xai-" + "Q7rT2vB9".repeat(10), "[REDACTED_XAI_KEY]"],
  ["Replicate token", "r8_" + "Lm3Np7Qr".repeat(4) + "St9Uv", "[REDACTED_REPLICATE_TOKEN]"],
  ["Perplexity key", "pplx-" + "c0ffee12".repeat(6), "[REDACTED_PERPLEXITY_KEY]"],
  ["Tavily key", "tvly-" + "dev-" + "Hj5Kl8Mn".repeat(4), "[REDACTED_TAVILY_KEY]"],
  ["Supabase access token", "sbp_" + "0a1b2c3d4e".repeat(4), "[REDACTED_SUPABASE_TOKEN]"],
  ["Supabase secret key", "sb_" + "secret_" + "N3w_Kf8-Pq2Lm7Zx9Wv4Ty", "[REDACTED_SUPABASE_TOKEN]"],
  ["age secret key", "AGE-SECRET-KEY-1" + "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L".repeat(2).slice(0, 58), "[REDACTED_AGE_KEY]"],
];

describe("more token formats", () => {
  it.each(TOKENS)("redacts a %s completely", (_, token, placeholder) => {
    const out = redact(`export KEY=${token} # set in CI\nuse ${token} for the client`);
    expect(out).not.toContain(token.slice(-12));
    expect(out).toContain(placeholder);
  });

  it.each([
    "Publishable keys start with pk_test_ and are safe to ship in the browser.",
    "The ya29 prefix marks a Google access token; rotate it with gcloud.",
    "gsk_ keys come from the Groq console and xai- keys from the xAI one.",
    "Read the r8_ token from REPLICATE_API_TOKEN and the sbp_ token from SUPABASE_ACCESS_TOKEN.",
    "See 1//0 in the docs for the refresh-token shape; the age tool prints AGE-SECRET-KEY-1 keys.",
  ])("leaves ordinary prose alone: %s", (text) => {
    expect(redact(text)).toBe(text);
  });
});

describe("private key blocks", () => {
  it("redacts an OpenPGP private key block", () => {
    const block = [
      "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      "",
      B64_LINE,
      B64_LINE.split("").reverse().join(""),
      "=j8Xa",
      "-----END PGP PRIVATE KEY BLOCK-----",
    ].join("\n");
    const out = redact(`exported:\n${block}\ndone`);
    expect(out).not.toContain(B64_LINE);
    expect(out).toBe("exported:\n[REDACTED_PRIVATE_KEY]\ndone");
  });

  it("redacts a private key cut off before its END line", () => {
    const truncated = ["-----BEGIN OPENSSH PRIVATE KEY-----", B64_LINE, B64_LINE, B64_LINE.slice(0, 40)].join("\n");
    const out = redact(`$ head -4 ~/.ssh/id_ed25519\n${truncated}\nThe rest of the file was not shown.`);
    expect(out).not.toContain(B64_LINE.slice(0, 20));
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).toContain("The rest of the file was not shown.");
  });

  it("redacts an encrypted key's armor headers along with its body", () => {
    const truncated = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "Proc-Type: 4,ENCRYPTED",
      "DEK-Info: AES-128-CBC,3F1A2B4C5D6E7F8091A2B3C4D5E6F708",
      "",
      B64_LINE,
    ].join("\n");
    const out = redact(truncated);
    expect(out).not.toContain("DEK-Info");
    expect(out).not.toContain(B64_LINE.slice(0, 20));
  });

  it("keeps a JSON payload parseable when a truncated key sits inside a string", () => {
    const payload = JSON.stringify({
      tool: "Bash",
      output: `-----BEGIN PRIVATE KEY-----\n${B64_LINE}\n${B64_LINE}`,
      exit: 0,
    });
    const out = redact(payload);
    expect(out).not.toContain(B64_LINE.slice(0, 20));
    const parsed = JSON.parse(out) as { tool: string; output: string; exit: number };
    expect(parsed.tool).toBe("Bash");
    expect(parsed.output).toBe("[REDACTED_PRIVATE_KEY]");
    expect(parsed.exit).toBe(0);
  });

  it("finishes quickly on a long run of base64-looking lines", () => {
    const long = "-----BEGIN PRIVATE KEY-----\n" + `${B64_LINE}\n`.repeat(5000) + "!";
    const started = Date.now();
    redact(long);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
