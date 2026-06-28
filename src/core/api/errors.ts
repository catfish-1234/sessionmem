export type DomainErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export interface ErrorEnvelope {
  code: DomainErrorCode;
  message: string;
  details?: unknown;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  // Don't surface internal .message (may contain fs paths) to MCP client.
  // Log the real message to stderr; return a static string to the caller.
  process.stderr.write(
    `[sessionmem] internal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  return {
    code: "INTERNAL",
    message: "Internal error",
  };
}
