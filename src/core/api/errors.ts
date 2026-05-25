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

  if (error instanceof Error) {
    return {
      code: "INTERNAL",
      message: error.message,
    };
  }

  return {
    code: "INTERNAL",
    message: "Unexpected error",
  };
}
