# TypeScript 7 upgrade status

The supported development toolchain currently uses TypeScript 6.0.3. Do not
force TypeScript 7 into the dependency tree or disable peer dependency checks.
This is a tooling compatibility issue, not an application type error.

## Why Dependabot PR #21 fails

PR #21 upgrades `typescript` from 6.0.3 to 7.0.2. On every CI platform, `npm ci`
fails with `ERESOLVE` before lint, typecheck, build, or tests run:

- The PR's typescript-eslint 8.62.1 requires `typescript >=4.8.4 <6.1.0`.
- The latest published typescript-eslint checked for this review, 8.71.2,
  still has that peer requirement. Updating the linter alone does not fix it.
- A separate scratch installation forced to TypeScript 7.0.2 plus
  typescript-eslint 8.71.2 fails on import with
  `Error: typescript-eslint does not support TS 7.0.`
- TypeScript 7's root export provides version information, not the previous
  compiler API: `createSourceFile` and `SyntaxKind` are both undefined.
  The new `typescript/unstable/*` APIs are not drop-in replacements for tools
  that consume TypeScript 6's API.

The standalone TypeScript 7.0.2 compiler successfully typechecks this repository
with `tsc --noEmit -p tsconfig.json`. That does not make the whole toolchain
compatible: ESLint imports typescript-eslint from `eslint.config.mjs`, so bypassing
npm's peer checks still leaves lint broken. No application or tsconfig change
can supply the missing upstream API.

## Upgrade criteria

Keep TypeScript 6 until typescript-eslint explicitly supports the selected
TypeScript 7 release and its import/parser work with that compiler. Dependabot
continues TypeScript 6 updates; TypeScript 7+ version updates are temporarily
ignored to avoid recreating a known failing PR. Remove that ignore when support
lands, update TypeScript and typescript-eslint together, regenerate the lockfile
with normal peer resolution, and run:

```bash
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

All CI operating systems and Node versions, including packaged-install smoke
tests and the security job, must pass before accepting the upgrade. Revisit
[PR #21](https://github.com/catfish-1234/sessionmem/pull/21) at that point.
