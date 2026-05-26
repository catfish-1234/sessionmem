export type RedactionRule = (input: string) => string;

export interface RedactionOptions {
  redactionEnabled: boolean;
  rules?: RedactionRule[];
}

export interface RedactionResult {
  text: string;
  warningCodes: string[];
}

function defaultRules(): RedactionRule[] {
  return [
    (input) =>
      input.replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "[REDACTED_EMAIL]",
      ),
    (input) =>
      input.replace(/sk-[a-zA-Z0-9]{12,}/g, "[REDACTED_API_KEY]"),
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
