import { describe, expect, it } from "vitest";

import { applyRedaction } from "../../../src/core/summarize/redaction.js";

const redact = (text: string) => applyRedaction(text, { redactionEnabled: true }).text;

// Synthetic values in each provider's published shape. Bodies deliberately include `_` and `-`
// where the real format allows them, because that is where the generic rules stopped short.
const TOKENS: Array<[string, string, string]> = [
  ["Anthropic API key", "sk-ant-api03-" + "Ab1_-xY9".repeat(12) + "AA", "[REDACTED_ANTHROPIC_KEY]"],
  ["Anthropic admin key", "sk-ant-admin01-" + "Zq8-_Lm2".repeat(12), "[REDACTED_ANTHROPIC_KEY]"],
  ["OpenAI project key", "sk-proj-" + "aB3_cD4-".repeat(16), "[REDACTED_API_KEY]"],
  ["OpenAI service-account key", "sk-svcacct-" + "Qw_e-R7t".repeat(12), "[REDACTED_API_KEY]"],
  ["Hugging Face token", "hf_" + "aBcD1234".repeat(4) + "xy", "[REDACTED_HF_TOKEN]"],
  ["SendGrid key", "SG." + "a".repeat(22) + "." + "b".repeat(43), "[REDACTED_SENDGRID_KEY]"],
  ["PyPI token", "pypi-AgEIcHlwaS5vcmc" + "A1_-".repeat(15), "[REDACTED_PYPI_TOKEN]"],
  ["Docker Hub PAT", "dckr_pat_" + "Ab3_".repeat(7), "[REDACTED_DOCKER_TOKEN]"],
  ["DigitalOcean token", "dop_v1_" + "a1".repeat(32), "[REDACTED_DIGITALOCEAN_TOKEN]"],
  ["Shopify token", "shpat_" + "a1b2".repeat(8), "[REDACTED_SHOPIFY_TOKEN]"],
  ["Linear key", "lin_api_" + "a1B2c3D4".repeat(5), "[REDACTED_LINEAR_KEY]"],
  ["Twilio API key", "SK" + "0123456789abcdef".repeat(2), "[REDACTED_TWILIO_KEY]"],
  ["Databricks token", "dapi" + "0123456789abcdef".repeat(2), "[REDACTED_DATABRICKS_TOKEN]"],
];

describe("provider token redaction", () => {
  it.each(TOKENS)("redacts a %s completely", (_, token, placeholder) => {
    const out = redact(`export KEY=${token} # set in CI\nuse ${token} for the client`);
    expect(out).not.toContain(token.slice(-12));
    expect(out).toContain(placeholder);
  });

  it("redacts Azure connection-string keys and keeps the rest of the string readable", () => {
    const key = "Ab3+/".repeat(16) + "==";
    const out = redact(`DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=${key};EndpointSuffix=core.windows.net`);
    expect(out).not.toContain(key);
    expect(out).toContain("AccountName=acme");
    expect(out).toContain("EndpointSuffix=core.windows.net");
  });

  it.each([
    "The SKU list is in skus.json and the dapi endpoint is documented.",
    "Use hf_hub_download for the weights; sk-learn is a different library.",
    "Rename shpat_helper to something clearer; lin_api_client wraps the SDK.",
    "SG.Rules applies to sg.example and the glpat- prefix marks GitLab tokens.",
  ])("leaves ordinary prose alone: %s", (text) => {
    expect(redact(text)).toBe(text);
  });
});
