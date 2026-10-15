#!/usr/bin/env node
// Propagate package.json's version to the satellite manifests that must not
// drift from it: the MCP registry descriptor, the Claude Code plugin manifest,
// and the mirrored package manifest.
//
// Invoked from the `version` npm lifecycle script (NOT `postversion`): `version`
// runs after the package.json bump but BEFORE npm creates the release commit
// and tag, so the files it touches can still be staged into that commit. Under
// `postversion` the sync landed after the tag was already cut, leaving the
// tagged tree with a bumped package.json and stale satellites — which is why
// past releases needed a manual follow-up commit.
import { readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  "package/package.json",
  ".claude-plugin/plugin.json",
  "server.json",
];

const root = JSON.parse(readFileSync("package.json", "utf8"));
const { version } = root;
if (!version) {
  console.error("sync-version: package.json has no version field");
  process.exit(1);
}

for (const file of TARGETS) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.version = version;
  // The secondary manifest must describe the same runtime/tooling as the root.
  if (file === "package/package.json") {
    for (const key of ["dependencies", "devDependencies", "engines", "bugs", "homepage"]) {
      if (root[key] === undefined) delete manifest[key];
      else manifest[key] = root[key];
    }
  }
  // server.json nests a per-package version alongside the top-level one.
  if (Array.isArray(manifest.packages)) {
    for (const pkg of manifest.packages) {
      pkg.version = version;
    }
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`sync-version: ${file} -> ${version}`);
}

const dockerfile = readFileSync("Dockerfile", "utf8");
if (!/^RUN npm install -g sessionmem@\S+$/m.test(dockerfile)) {
  throw new Error("sync-version: Dockerfile has no sessionmem install pin");
}
writeFileSync("Dockerfile", dockerfile.replace(
  /^(RUN npm install -g sessionmem@)\S+$/m,
  (_line, prefix) => `${prefix}${version}`,
));
console.log(`sync-version: Dockerfile -> ${version}`);
