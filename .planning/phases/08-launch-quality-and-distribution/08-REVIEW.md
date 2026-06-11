---
phase: 08-launch-quality-and-distribution
reviewed: 2026-06-11T16:45:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - server.json
  - .claude-plugin/marketplace.json
  - .claude-plugin/plugin.json
  - .mcp.json
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-06-11T16:45:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the CI/release workflow files and distribution metadata (npm/MCP registry server manifest, Claude plugin marketplace/plugin manifests, and the `.mcp.json` config template). The CI pipeline (`ci.yml`) is solid: it runs lint/typecheck/test/build across a 3-OS x 2-Node matrix, and the install-smoke job exercises a real global install + isolated-HOME `install`/`ping`/`--version` flow on all three platforms. The release workflow correctly scopes `id-token: write` to the publish job only and relies on OIDC trusted publishing.

The main issues found are not crashes or security holes, but **maintainability/drift risks** around version management: the package version (`1.0.0`) is hardcoded in three separate places (`package.json`, `server.json` top-level, and `server.json packages[0].version`) with no automated check that they stay in sync, and the tag-triggered release workflow does not validate that the git tag matches the published `package.json` version before calling `npm publish`. Both are the kind of issue that won't manifest until the *second* release, when they're easy to get wrong.

## Warnings

### WR-01: Release workflow does not validate tag matches package.json version

**File:** `.github/workflows/release.yml:8-42`
**Issue:** The workflow triggers on any `v*` tag push and immediately runs `npm publish` after build/test, but never checks that the pushed tag (e.g. `v1.0.1`) matches the `version` field in `package.json`. If a maintainer pushes a tag without bumping `package.json` (or bumps `package.json` but forgets to tag correctly), one of two bad outcomes occurs:
- npm publish fails late with an unhelpful "version already exists" error if the version wasn't bumped, or
- npm publishes a release whose package version doesn't match the git tag that triggered it, causing permanent drift between the tag history and the published version history (tags can't be easily renamed once pushed/used for a release).

This is a correctness/process gap that will surface on the first version bump after 1.0.0.

**Fix:** Add a verification step before `npm publish` that compares the tag (stripped of the `v` prefix) to `package.json`'s `version`:
```yaml
      - name: Verify tag matches package.json version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION=$(node -p "require('./package.json').version")
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag version ($TAG_VERSION) does not match package.json version ($PKG_VERSION)"
            exit 1
          fi
```

### WR-02: Version number duplicated across three manifests with no sync mechanism

**File:** `server.json:9,14`, `package.json:3`
**Issue:** The version `1.0.0` is hardcoded independently in:
- `package.json` `"version": "1.0.0"` (the source of truth, per the comment in `src/cli/index.ts`)
- `server.json` top-level `"version": "1.0.0"` (line 9)
- `server.json` `packages[0].version` `"1.0.0"` (line 14)

There is no script or CI check that keeps these three in sync. On the next release, a maintainer who only bumps `package.json` (the documented single source of truth for `--version`) will silently leave `server.json` pointing at the stale version, which the MCP registry will then serve to clients as the "latest" version metadata — pointing at an npm package version that may no longer be installable as "latest" or that mismatches the registry's expectation.

**Fix:** Either generate `server.json`'s version fields from `package.json` at publish time (e.g., a small `scripts/sync-server-json.mjs` run in the release workflow before publish/registry submission), or add a CI check in `ci.yml` that fails if the three version strings diverge:
```yaml
      - name: Verify server.json version matches package.json
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          SERVER_VERSION=$(node -p "require('./server.json').version")
          PACKAGE_VERSION=$(node -p "require('./server.json').packages[0].version")
          if [ "$PKG_VERSION" != "$SERVER_VERSION" ] || [ "$PKG_VERSION" != "$PACKAGE_VERSION" ]; then
            echo "Version mismatch: package.json=$PKG_VERSION server.json=$SERVER_VERSION server.json.packages[0]=$PACKAGE_VERSION"
            exit 1
          fi
```

## Info

### IN-01: Large commented-out fallback block in release.yml

**File:** `.github/workflows/release.yml:43-53`
**Issue:** An 11-line commented-out `env:` block (NPM_TOKEN fallback) is checked into the workflow. While the accompanying comments explain it's intentional documentation for a fallback path, commented-out YAML config that a maintainer might uncomment under pressure during an incident is a maintenance smell — it's untested and could easily have a YAML indentation error that only surfaces when actually needed.
**Fix:** Consider moving this fallback guidance to a `docs/RELEASING.md` or similar runbook instead of leaving dead config in the workflow file, so it doesn't bit-rot silently and so any uncomment-and-use action goes through review against current YAML.

### IN-02: Windows tarball glob in install-smoke assumes exactly one match with no diagnostic on empty result

**File:** `.github/workflows/ci.yml:70-75`
**Issue:** 
```powershell
$tarball = Get-ChildItem -Filter "sessionmem-*.tgz" | Select-Object -First 1
npm install -g "./$($tarball.Name)"
```
If `npm pack` (previous step) failed to produce a matching file for any reason (e.g., package name change, scoped package rename to `@scope/sessionmem` producing `scope-sessionmem-*.tgz`), `Get-ChildItem` returns `$null`, `$tarball.Name` evaluates to an empty string, and `npm install -g "./"` would run against the current directory instead of failing with a clear "no tarball found" message — producing a confusing downstream failure in the `--version`/`ping`/`install` steps rather than a clear root cause at the install step.
**Fix:** Add an explicit null-check with a clear error before proceeding:
```powershell
$tarball = Get-ChildItem -Filter "sessionmem-*.tgz" | Select-Object -First 1
if (-not $tarball) {
  Write-Error "No sessionmem-*.tgz tarball found after npm pack"
  exit 1
}
npm install -g "./$($tarball.Name)"
```

---

_Reviewed: 2026-06-11T16:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
