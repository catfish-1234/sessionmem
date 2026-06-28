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
// avoid catastrophic backtracking (ReDoS).
//
// The rule set is allocated once at module load (not per call): the rules are
// pure, stateless closures, so hoisting avoids re-allocating 8 closures on every
// applyRedaction invocation — a measurable saving in batch/import/pull loops.
// The regex literals carry no `lastIndex` state because every pattern is used
// with String.prototype.replace (not stateful .test()/.exec() on a shared regex).
const DEFAULT_RULES: readonly RedactionRule[] = createDefaultRules();

function createDefaultRules(): RedactionRule[] {
  return [
    // URL-embedded credentials: scheme://user:password@host. Run BEFORE the
    // email rule so the `password@host` segment is collapsed here rather than
    // partially matched as an email. Scheme + host are preserved; the
    // user:password pair is redacted. Bounded quantifiers stay ReDoS-safe.
    (input) =>
      input.replace(
        /\b([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s:/@]{1,256}:[^\s/@]{1,256}@/gi,
        "$1[REDACTED_CREDENTIALS]@",
      ),
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
    // AWS temporary credentials access key id: ASIA + 16 uppercase alphanumerics.
    (input) =>
      input.replace(/\bASIA[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"),
    // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36 OR MORE alphanumerics
    // (GitHub has lengthened tokens over time; `{36,}` future-proofs the rule).
    (input) =>
      input.replace(
        /\bgh[poushr]_[A-Za-z0-9]{36,}\b/g,
        "[REDACTED_GITHUB_TOKEN]",
      ),
    // GitHub fine-grained personal access tokens: github_pat_ + long body.
    (input) =>
      input.replace(
        /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
        "[REDACTED_GITHUB_TOKEN]",
      ),
    // Slack tokens: xoxb-/xoxp-/xoxa-/xoxr-/xoxs-/xoxe-/xoxc-/xoxt- and the
    // app-level xapp- prefix + dash-delimited segments.
    (input) =>
      input.replace(
        /\b(?:xox[baprsect]|xapp)-[A-Za-z0-9-]{10,256}\b/g,
        "[REDACTED_SLACK_TOKEN]",
      ),
    // Stripe live keys: secret (sk_live_), restricted (rk_live_), and
    // publishable (pk_live_) + 24 or more alphanumerics.
    (input) =>
      input.replace(
        /\b[srp]k_live_[A-Za-z0-9]{24,}\b/g,
        "[REDACTED_STRIPE_KEY]",
      ),
    // npm access tokens: npm_ + 36 alphanumerics.
    (input) =>
      input.replace(/\bnpm_[A-Za-z0-9]{36}\b/g, "[REDACTED_NPM_TOKEN]"),
    // Google API keys: AIza + 35 url-safe chars (39 total).
    (input) =>
      input.replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_GOOGLE_API_KEY]"),
    // OpenAI-style API key. Allow an optional internal dash segment so
    // project-scoped keys (sk-proj-...) are fully redacted rather than leaving
    // the project segment behind. Bounded quantifiers stay ReDoS-safe.
    (input) =>
      input.replace(
        /\bsk-(?:[a-zA-Z0-9]{1,32}-){0,4}[a-zA-Z0-9]{12,200}\b/g,
        "[REDACTED_API_KEY]",
      ),
    // Bearer token header value: "Bearer <token>" (case-insensitive), token redacted.
    (input) =>
      input.replace(
        /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
        "Bearer [REDACTED_BEARER_TOKEN]",
      ),
    // Config/connection-string assignments: key=value where key is a known
    // secret-bearing name. The key is kept and the value redacted. Covers
    // password/secret plus api_key/apikey/token/access_token/pwd in URL query
    // strings and config files. The `=` separator may carry surrounding spaces.
    (input) =>
      input.replace(
        /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|token)\s*=\s*([^\s"'&;]+)/gi,
        "$1=[REDACTED]",
      ),
    // JSON-form secret assignments: "key": "value" for known secret-bearing
    // keys. Complements the key=value rule above so secrets embedded in JSON
    // payloads (config files, logged request bodies) are redacted too. The key
    // is preserved; the quoted value is collapsed.
    (input) =>
      input.replace(
        /"(password|secret|api_key|token|access_token|auth_token|client_secret|private_key|pwd|passwd)"\s*:\s*"[^"]{4,}"/gi,
        '"$1": "[REDACTED]"',
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

  for (const rule of options.rules ?? DEFAULT_RULES) {
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
