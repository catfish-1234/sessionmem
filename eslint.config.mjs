// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  // Non-type-checked recommended set: fast for CI (no full type graph build).
  ...tseslint.configs.recommended,
  {
    // Codebase convention: a leading underscore marks an intentionally-unused
    // binding (e.g. `_code`, `_projectId`, unused method params). Honor it
    // instead of forcing churn across the existing source/tests.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Plain Node ESM scripts (build/copy helpers) run in the Node runtime, not
    // the browser — expose Node globals so `console`/`process` resolve.
    files: ["scripts/**/*.mjs", "**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Test assertions deliberately match raw ANSI escape codes (\x1b) when
      // verifying colorized CLI output.
      "no-control-regex": "off",
    },
  },
);
