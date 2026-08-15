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
/**
 * Key names that mark an assignment's value as a secret. Matched
 * case-insensitively and allowed to carry bounded affixes on either side, so
 * `AWS_SECRET_ACCESS_KEY` and `SECRET_TOKEN_VALUE` match as readily as `secret`.
 */
const SECRET_KEY_NAMES = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "api[_-]?key",
  "apikey",
  "access[_-]?token",
  "refresh[_-]?token",
  "auth[_-]?token",
  "client[_-]?secret",
  "private[_-]?key",
  "credentials?",
  "token",
].join("|");

/**
 * `<key><separator><value>` where the key names a secret. Capture groups are
 * (key, separator, value) so the replacement can keep the key and separator
 * verbatim and swap only the value.
 *
 * Both `:` and `=` are accepted (YAML, JSON, `.env`, query strings, log lines),
 * and the value may be backslash-escaped-quoted, double-quoted, single-quoted,
 * or bare. Every quantifier is bounded, so the pattern is ReDoS-safe.
 *
 * The escaped-quote branch comes first and the bare branch excludes `\`, which
 * together keep a JSON payload parseable after redaction. Session events store
 * JSON, so a secret inside a stringified field arrives as `password=\"a b\"`;
 * letting the bare branch match the lone backslash replaced it with
 * `[REDACTED]` and left the rest of the quoted run stranded, producing
 * unparseable JSON.
 */
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b([A-Za-z0-9_.-]{0,40}(?:${SECRET_KEY_NAMES})[A-Za-z0-9_.-]{0,40}\\?"?)(\s*[:=]\s*)(\\"(?:\\.|[^"\\]){0,4096}\\"|"[^"\n]{1,4096}"|'[^'\n]{1,4096}'|[^\s"'\\,;&}]{1,4096})`,
  "gi",
);

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
    // HTTP Basic auth header: the base64 blob encodes user:password verbatim.
    (input) =>
      input.replace(
        /\bBasic\s+[A-Za-z0-9+/]{12,}={0,2}/g,
        "Basic [REDACTED_BASIC_AUTH]",
      ),
    // Slack incoming-webhook URLs — the path IS the credential, so the whole
    // path is collapsed rather than a token-shaped substring of it.
    (input) =>
      input.replace(
        /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{10,200}/g,
        "https://hooks.slack.com/services/[REDACTED_SLACK_WEBHOOK]",
      ),
    // Secret-bearing assignments: `<key><sep><value>` for a known secret-ish key
    // name, covering config files, .env exports, YAML, JSON bodies, log lines
    // and URL query strings in one rule.
    //
    // Three things the narrower predecessors missed, each a real leak:
    //  - `:` as a separator (YAML, JSON, `Header: value` log lines). Only `=`
    //    was handled, so `aws_secret_access_key: wJalr…` passed through.
    //  - Affixed key names. The keyword had to sit on a \b boundary, and `_` is
    //    a word character, so `AWS_SECRET_ACCESS_KEY` and `SECRET_TOKEN_VALUE`
    //    never matched. Allow bounded affixes on both sides.
    //  - Quoted values. The value class excluded quotes, so `password="a b c"`
    //    matched nothing at all.
    //
    // Quoted values keep their delimiters so a redacted JSON payload stays
    // parseable. All quantifiers are bounded and the alternation is
    // non-backtracking on failure, so the rule stays ReDoS-safe.
    (input) =>
      input.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, value: string) => {
        // Preserve the value's quote style so a redacted JSON payload stays
        // parseable and a redacted YAML line stays well-formed.
        const quote = value.startsWith('\\"')
          ? '\\"'
          : value.startsWith('"')
            ? '"'
            : value.startsWith("'")
              ? "'"
              : "";
        return `${key}${separator}${quote}[REDACTED]${quote}`;
      }),
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
