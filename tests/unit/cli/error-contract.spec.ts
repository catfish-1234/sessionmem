import { it } from "vitest";

it.todo("top-level error handler prints error.message to stderr and calls process.exit(1)");
it.todo("command action that throws DomainError surfaces error.message (not JSON envelope) to stderr");
it.todo("command action that throws unknown error surfaces String(err) to stderr");
