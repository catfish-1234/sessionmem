import { describe, expect, it } from "vitest";
import { extractFactClaims, supersessionReason } from "../../../src/core/extract/factClaims.js";

const reason = (old: string, current: string) => {
  const [a] = extractFactClaims(old), [b] = extractFactClaims(current);
  return a && b ? supersessionReason(a, b) : undefined;
};

describe("deterministic fact supersession", () => {
  it.each([
    ["I use VS Code.", "I switched to Neovim.", "different_value"],
    ["I use tool Acme.", "I switched from tool Acme to tool Other.", "different_value"],
    ["I use VS Code.", "I replaced VS Code with Neovim.", "different_value"],
    ["I use `VS Code`.", "I use \"Neovim\".", "different_value"],
    ["Alice prefers Rust.", "Alice now prefers Python.", "different_value"],
    ["Alice uses tool Acme for local storage.", "Alice uses tool Other for local storage.", "different_value"],
    ["Alice uses SQLite for the local database.", "Alice uses PostgreSQL for our local database.", "different_value"],
    ["Alice uses SQLite for persistent local data storage.", "Alice uses PostgreSQL for local data storage.", "different_value"],
    ["I use VS Code.", "I no longer use VS Code.", "explicit_negation"],
    ["I use VS Code.", "I don't use VS Code.", "explicit_negation"],
    ["I use VS Code.", "I stopped using VS Code.", "explicit_negation"],
    ["I use VS Code.", "I am not using VS Code.", "explicit_negation"],
    ["Alice prefers Rust.", "Alice does not prefer Rust.", "explicit_negation"],
    ["I do not use VS Code.", "I use VS Code.", "explicit_negation"],
  ])("compares %s -> %s", (a, b, expected) => expect(reason(a, b)).toBe(expected));

  it.each([
    ["I use VS Code.", "I use VS Code."],
    ["I use VS Code.", "I use vscode."],
    ["I use VS Code.", "I use Docker."],
    ["Alice uses SQLite.", "Bob uses PostgreSQL."],
    ["Alice uses SQLite.", "Alice prefers PostgreSQL."],
    ["Alice uses Python for scripting.", "Alice uses Rust for backend."],
    ["Alice works on project Atlas.", "Alice works on project Borealis."],
    ["Alice uses SQLite.", "Alice does not use PostgreSQL."],
    ["Alice decided to fix tests.", "Alice decided to write docs."],
    ["I use VS Code.", "Should I use Neovim?"],
    ["I use VS Code.", "I might use Neovim."],
  ])("keeps compatible or uncertain facts: %s / %s", (a, b) => expect(reason(a, b)).toBeUndefined());

  it("keeps the final assertion per slot and resolves explicit speakers", () => {
    const claims = extractFactClaims("Alice: I use VS Code. I switched to Neovim.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ source: { name: "alice" }, target: { name: "neovim" } });
    expect(extractFactClaims("I use tool sk-abcdefghijklmnopqrstuvwxyz123456789."))
      .toEqual([]);
  });
});
