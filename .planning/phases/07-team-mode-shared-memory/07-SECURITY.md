# SECURITY — Phase 07: Team Mode Shared Memory

**Audit date:** 2026-06-11
**ASVS Level:** default
**Disposition:** SECURED — 15/15 threats resolved (CLOSED or documented accepted risk)
**Block_on:** default

This phase introduces team-mode shared memory: a new untrusted-input surface
(teammate JSON snapshots on a shared filesystem path) merged into the local
SQLite store. The threat register was authored at plan time across plans 07-01
through 07-05. Every declared mitigation was verified against implemented code;
documentation/intent alone was not accepted as evidence.

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-07-01 | Tampering | mitigate | CLOSED | `005_team_provenance.sql:8-9` — `ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT ''` + `ADD COLUMN origin_project_id TEXT` (additive, no row rewrite; existing rows survive). |
| T-07-04 | Tampering | mitigate | CLOSED | Exhaustive author/origin_project_id threading: `memorySearchRepo.ts:12-13,30-31,64` (SELECT + row/candidate types), `retrieveMemories.ts:34-35,118-119` (RetrievedMemoryCandidate + mapper), `memoryRepo.ts:20-21,33-37,55-74,88` (insert/upsert column lists + `excluded.*` + toParams default), `memoryCoreService.ts:73-74,141-142,161-162,180` (DTO fields + mappers + getMemoryById SELECT), `contracts.ts:131-132` (optional schema fields). |
| T-07-08 | Tampering | mitigate | CLOSED | `team.ts:117-121` — parameterized `DELETE FROM memories WHERE project_id = ? AND author != ? AND author != ''` bound with `.run(context.projectId, context.username)`; no string concatenation. (Additional `author != ''` clause preserves legacy/local rows — strictly safer than plan, not weaker.) |
| T-07-09 | Tampering | mitigate | CLOSED | `policyConfig.ts:27-32` `teamConfigShape` ends in `.strict()`; write schema `policyConfigSchema` `.strict()` (line 49); read schema `policyConfigReadSchema` `.strip()` (line 58); `team` default `{ enabled: false }` (lines 17, 42, 165). |
| T-07-02 | Information Disclosure | mitigate | CLOSED | `memoryCoreService.ts:613-620` (pullMemories) — `applyRedaction(memory.content, ...)` run on every pulled record regardless of teammate redaction setting, then `deterministicEmbed(redaction.text, ...)` re-embeds the redacted text; redacted `redaction.text` is persisted as content (line 629). |
| T-07-03 | Tampering / DoS | mitigate | CLOSED | `sync.ts:100-124` — per-file `JSON.parse` in try/catch skip-and-warn (104-107), `Array.isArray` guard skip-and-warn (108-111), per-record `importMemoryRecordSchema.safeParse` skip-and-warn (116-122); one bad file/record never aborts the pull. |
| T-07-06 | Tampering | mitigate | CLOSED | `memoryCoreService.ts:583-603` (pullMemories) — `ownerStmt` SELECTs existing `project_id` by id; a colliding id owned by a different project increments `skippedCrossProject` and `continue`s (skip, not overwrite). |
| T-07-07 | Tampering (path traversal) | mitigate | CLOSED | `sync.ts:64-66,86-87,103` — write/read paths built via `path.join(sharedPath, context.projectId, \`${context.username}.json\`)` from LOCAL projectId/username only; file enumeration via `readdirSync(dir)`; never uses a path string from inside a teammate file. Username sanitized at source: `context.ts:45` `.replace(/[^A-Za-z0-9._-]/g, "_")` with `"user"` fallback. |
| T-07-12 | DoS | mitigate | CLOSED | `sync.ts:65-73` — atomic write: `writeFileSync(tmpPath, ...)` to `${username}.json.tmp` in the same dir then `renameSync(tmpPath, finalPath)`; pull side skip-and-warns on parse (T-07-03). |
| T-07-05 (display) | Spoofing / Info Disclosure | mitigate | CLOSED | `formatStartupInjection.ts:60-73` — `authorPrefix` returns a prefix ONLY when `memory.author && localUsername && memory.author !== localUsername`; missing `localUsername` or matching author yields no prefix (never a wrong/misleading attribution). |
| T-07-10 | Information Disclosure | accept | CLOSED | `team.ts:50-93` — `teamStatusCommand` reads local fs only (existence + writability probe of an operator-supplied path); no remote surface. Accepted risk logged below. |
| T-07-11 | Spoofing | accept | CLOSED | `docs/team-mode.md:129-142` — trust boundary documented: author is "advisory provenance, not an authentication control"; real boundary is OS filesystem ACLs on the shared path. Accepted risk logged below. |
| T-07-05 (trust) | Spoofing | accept | CLOSED | `docs/team-mode.md:137-142` — deeper spoofing (fabricated author) documented as advisory provenance, cross-referenced to T-07-11. Accepted risk logged below. |
| T-07-05-01 | Information Disclosure | accept | CLOSED | `search.ts:42` — `console.log(result.startupInjection)`; `startupInjection` derived solely from `result.memories` already printed via `formatTable`; local stdout only, no new disclosure. Accepted risk logged below. |
| T-07-SC / T-07-05-SC | Tampering (supply chain) | accept/mitigate | CLOSED | No phase-07 commit modified `package.json`; last dep change was `6841ef4` (phase 05). No new packages introduced across plans 07-01..07-05. |

---

## Accepted Risks Log

The following threats are dispositioned `accept` by the plan-time threat register
and are recorded here as accepted residual risk for phase 07:

- **T-07-10 — `team status` path probe (Information Disclosure).** `team status`
  performs a local existence + writability probe of an operator-supplied shared
  path (temp-file write/unlink, `team.ts:73-90`). No remote surface; the path is
  operator-controlled at the same trust level as the process. Accepted.

- **T-07-11 — teammate sets arbitrary `author` (Spoofing).** A teammate with
  write access to the shared directory can place a snapshot with a fabricated
  `author`. `author` is advisory provenance, not a security control; the trust
  boundary is the OS filesystem ACL on the shared path. Documented in
  `docs/team-mode.md:129-142`. Accepted.

- **T-07-05 (trust portion) — author annotation in injection (Spoofing).** The
  rendered `author:` prefix reflects what a snapshot claims, not verified
  authorship. Display logic is hardened (no false attribution — see CLOSED
  display mitigation above); the residual spoofing risk is the same as T-07-11.
  Accepted.

- **T-07-05-01 — `console.log(result.startupInjection)` in search.ts
  (Information Disclosure).** The startup-injection block is derived solely from
  `result.memories`, which the same command already prints via `formatTable`.
  Output is local to the invoking user's stdout; no PII added. Accepted.

- **T-07-SC / T-07-05-SC — supply chain (Tampering).** Phase 07 installs no new
  packages; verified no phase-07 commit touches `package.json` dependencies.
  Accepted/mitigated by absence of install surface.

---

## Unregistered Flags

None. No SUMMARY.md in `07-01`..`07-05` declared a `## Threat Flags` section, and
no new attack surface was discovered during the audit beyond the registered
threats. Every implementation change maps to a registered threat ID.

---

## Audit Method Notes

- Implementation files were treated as READ-ONLY; no implementation file was
  modified. Only this SECURITY.md was created.
- Each `mitigate` threat was verified by locating the actual mitigation call/SQL
  in the cited file (not by code-structure inference). The two highest-risk
  write paths — `pullMemories` re-redaction (T-07-02) and `ownerStmt`
  cross-project skip (T-07-06) — were read in full to confirm the mitigation
  applies to every pulled record in the loop, not just at a single entry point.
- Each `accept` threat was confirmed to have either local-only scope (no remote
  surface) or explicit trust-boundary documentation in `docs/team-mode.md`, and
  is recorded in the Accepted Risks Log above.
- Supply-chain disposition was verified against git history, not against
  documentation claims.

**Result: SECURED. No open threats. Phase 07 may ship.**
