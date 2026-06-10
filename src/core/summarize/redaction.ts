export type RedactionRule = (input: string) => string;

export interface RedactionOptions {
  redactionEnabled: boolean;
  rules?: RedactionRule[];
}

export interface RedactionResult {
  text: string;
  warningCodes: string[];
}

// Rule ordering note: structural multi-segment secrets (PEM private-key blocks,
// JWTs) run BEFORE the narrower single-token rules so a broad rule cannot redact
// a fragment of a larger secret and leave a partial body behind. All patterns are
// anchored with explicit literal prefixes/markers and use bounded quantifiers to
// avoid catastrophic backtracking (ReDoS — see threat T-06-03).
function defaultRules(): RedactionRule[] {
  return [
    // Email (original rule — unchanged).
    (input) =>
      input.replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[REDACTED_EMAIL]",
      ),
    // PEM private key block: ----BEGIN <type> PRIVATE KEY---- ... ----END ... ----.
    // Run before per-token rules so the whole block collapses to one placeholder.
    (input) =>
      input.replace(
        /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g,
        "[REDACTED_PRIVATE_KEY]",
      ),
    // JWT: three base64url segments separated by dots, header begins with "eyJ".
    (input) =>
      input.replace(
        /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
        "[REDACTED_JWT]",
      ),
    // AWS access key id: AKIA + 16 uppercase alphanumerics.
    (input) =>
      input.replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"),
    // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36 alphanumerics.
    (input) =>
      input.replace(
        /\bgh[poushr]_[A-Za-z0-9]{36}\b/g,
        "[REDACTED_GITHUB_TOKEN]",
      ),
    // OpenAI-style API key (original rule — unchanged).
    (input) =>
      input.replace(/sk-[a-zA-Z0-9]{12,}/g, "[REDACTED_API_KEY]"),
    // Bearer token header value: "Bearer <token>" (case-insensitive), token redacted.
    (input) =>
      input.replace(
        /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
        "Bearer [REDACTED_BEARER_TOKEN]",
      ),
    // Connection-string assignment: password=/secret= value -> key kept, value redacted.
    (input) =>
      input.replace(
        /\b(password|secret)=([^\s"'&;]+)/gi,
        "$1=[REDACTED]",
      ),
  ];
}

export function applyRedaction(
  input: string,
  options: RedactionOptions,
): RedactionResult {
  if (!options.redactionEnabled) {
    return {
      text: input,
      warningCodes: [],
    };
  }

  let text = input;
  const warningCodes: string[] = [];

  for (const rule of options.rules ?? defaultRules()) {
    try {
      text = rule(text);
    } catch {
      warningCodes.push("redaction_partial_failure");
    }
  }

  return {
    text,
    warningCodes,
  };
}
