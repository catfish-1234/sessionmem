# SECURITY.md — Phase 06: Security, Privacy, and Retention Hardening

**Audit date:** 2026-06-11
**ASVS Level:** 1
**block_on:** high
**Result:** SECURED — 25/25 threats closed (no open BLOCKERs)

This file records the security audit of Phase 06. Each threat in the phase
STRIDE register (authored across `06-01-PLAN.md` … `06-07-PLAN.md`
`<threat_model>` blocks) was verified against the implemented code and tests —
documentation/intent alone was not accepted as evidence. All 103 tests across
the 14 Phase 6 security test files were executed live and pass.

---

## Threat Verification (mitigate)

| Threat ID | Category | Evidence (file:line) |
|-----------|----------|----------------------|
| T-06-01 | Information Disclosure — redaction coverage | `src/core/summarize/redaction.ts:18-64` — `defaultRules()` covers all 8 categories (email, PEM, JWT, AWS `AKIA`, GitHub `gh[poushr]_`, `sk-`, Bearer, `password=`/`secret=`). Asserted by `tests/integration/core/secret-leakage.spec.ts` (8 categories, `not.toContain(raw)`). PASS. |
| T-06-02 | Tampering — config.json parsing | `src/core/config/policyConfig.ts:62-70` — `readPolicyConfig` wraps `JSON.parse` + zod `.parse` in try/catch, returns `DEFAULT_POLICY_CONFIG` on any failure. `tests/unit/core/policy-config.spec.ts` PASS. |
| T-06-03 | DoS — ReDoS | `src/core/summarize/redaction.ts:13-63` — all patterns anchored with explicit literal prefixes (`AKIA`, `gh[poushr]_`, `eyJ`, `-----BEGIN`) and bounded quantifiers (`{16}`, `{36}`, `{0,40}`, `*?` on a delimited block). Prose-no-op guard in `redaction-rules.spec.ts`. PASS. |
| T-06-04 | EoP — unknown config keys | `src/core/config/policyConfig.ts:33,42,86` — `.strict()` write schema rejects unknown keys (throws before any write); `.strip()` read schema discards them. Tested in `policy-config.spec.ts`. PASS. |
| T-06-05 | Tampering — deleteMemoriesOlderThan SQL | `src/core/storage/memoryRepo.ts:124-142` — `DELETE … WHERE project_id = ? AND created_at < ?` with `.run(projectId, cutoffIso)`; no interpolation. `prune-memories.spec.ts` asserts placeholders. PASS. |
| T-06-06 | DoS/data loss — wrong-rows deletion | `src/core/api/memoryCoreService.ts:486-503` — `dryRun` defaults true (contract); cutoff scoped by `project_id AND created_at`. `tests/integration/core/retention-prune.spec.ts` proves only intended rows deleted, session_events retained. PASS. |
| T-06-07 | Repudiation — unbounded delete on misconfig | `src/core/api/memoryCoreService.ts:486-488` — `retentionDays <= 0` returns `{deleted:0, eligible:0}` before any cutoff is computed. PASS. |
| T-06-09 | Information Disclosure — store/import bypass | `memoryCoreService.ts:262-285` (storeMemory) and `:444-468` (importMemories) call `applyRedaction` before `deterministicEmbed`/persist. `redaction-write-paths.spec.ts` + `secret-leakage.spec.ts` assert raw secrets absent. PASS. |
| T-06-10 | Information Disclosure — redactExisting preview echo | `memoryCoreService.ts:529-537` — previews built from `redaction.text` (REDACTED), truncated to `REDACT_PREVIEW_MAX_LENGTH` on code-point boundaries (`Array.from(...).slice`, IN-01 fix). `redact-existing.spec.ts` asserts bounded length. PASS. |
| T-06-11 | Tampering — updateMemoryContent SQL | `src/core/storage/memoryRepo.ts:170-198` — parameterized `UPDATE … SET content=?, … WHERE project_id=? AND id=?`; mirrors `updateMemoryImportance`. PASS. |
| T-06-12 | Repudiation — silent redaction failure | `redaction.ts:80-86` emits `redaction_partial_failure`; surfaced via `warningCodes` in `storeMemory` (`:295`) and `importMemories` (`:476`). PASS. |
| T-06-13 | DoS/data loss — unattended auto-prune | `src/core/api/sessionLifecycleService.ts:188-202` — `runLightPrune` reuses scoped/parameterized `deleteMemoriesOlderThan`; `retentionDays<=0` disabled (`:191`). `session-end-auto-prune.spec.ts` proves only aged rows deleted, summary preserved. PASS. |
| T-06-14 | Availability — prune failure blocking summarization | `sessionLifecycleService.ts:188-202` — entire prune body in try/catch that swallows errors. Test forces a throw; `handleSessionEnd` still returns ok. PASS. |
| T-06-15 | Tampering — config-driven cutoff | `sessionLifecycleService.ts:149-160` — `retentionDays` from `readPolicyConfig` (zod-validated), falls back to `DEFAULT_POLICY_CONFIG.retentionDays` (90) on failure, never to a delete-everything cutoff. PASS. |
| T-06-16 | DoS/data loss — prune without confirmation | `src/cli/commands/retention.ts:59-79` — `dryRun = !options.force`; deletion only on explicit `--force`. `tests/integration/cli/retention-prune.spec.ts` asserts no deletion without `--force`. PASS. |
| T-06-17 | Tampering — config set unknown/arbitrary keys | `src/cli/commands/config.ts:60-124` — `CONFIG_KEYS` allowlist; unknown key → error + `process.exit(1)` with no write; invalid value rejected by `coerce` before `writePolicyConfig`. `config-command.spec.ts` asserts file unchanged. PASS. |
| T-06-18 | Tampering — install clobbering user config | `src/cli/commands/install.ts:55-60` — writes defaults only when `!existsSync(configPath)`; existing config preserved. `install.spec.ts` asserts pre-existing `retentionDays` preserved. PASS. |
| T-06-20 | Information Disclosure — redact-scan preview leak | `src/cli/commands/redactScan.ts:50-54` prints `result.previews` produced as already-redacted, length-bounded strings by `redactExisting`. `redact-scan.spec.ts` asserts no full raw secret in output. PASS. |
| T-06-21 | Information Disclosure — undetected pattern leakage | `tests/integration/core/secret-leakage.spec.ts` — all 8 D-05 categories across storeMemory/importMemories/auto-summarize/redactExisting, each with `not.toContain(raw)` + placeholder assertion. 103 tests PASS. |
| T-06-22 | Tampering — redact-scan mutating without intent | `redactScan.ts:27,29-32` — `apply = !!options.apply`; scan calls `redactExisting` with `apply:false` (non-destructive default). `redact-existing.spec.ts` + `redact-scan.spec.ts` assert scan leaves rows intact. PASS. |
| T-06-24 | Repudiation/misinformation — docs vs behavior | `docs/privacy-and-retention.md` authored from implemented behavior; `tests/integration/docs/privacy-docs.spec.ts` asserts documented command/category tokens exist. PASS. |
| T-06-SC (plan 03) | Tampering — package installs | No package install in Phase 6 — `package.json` untouched by any Phase 6 commit (last change `6841ef4`, Phase 05). VERIFIED. |
| T-06-SC (plan 05) | Tampering — package installs | Same — no new installs. VERIFIED. |
| T-06-SC (plan 06) | Tampering — package installs | Same — no new installs. VERIFIED. |

---

## Accepted Risks Log (accept)

| Threat ID | Category | Rationale | Verification |
|-----------|----------|-----------|--------------|
| T-06-08 | Information Disclosure — error leakage (core) | Errors route through the existing `toErrorEnvelope`/`toErrorResponse` path that shapes DomainError codes/messages; no new sensitive data exposed. Accepted: no new error surface introduced by retention/redaction methods. | `memoryCoreService.ts` prune/redact methods return error envelopes via the `call` dispatcher. |
| T-06-19 | Information Disclosure — CLI error output | CLI prints `DomainError`/validation messages to stderr per the existing Phase 5 convention (`console.error` + `process.exit(1)`); no secrets surfaced. Accepted as low residual risk. | `retention.ts:67-69`, `config.ts:80-83,102-117`, `redactScan.ts:34-37`. |
| T-06-23 | Repudiation — stats misreporting policy state | `stats` reads the validated `policyConfig` and a dry-run eligible count for display only; no enforcement action is driven by the output. Low risk. | `src/cli/commands/stats.ts:49-60` (`Retention:`/`Redaction:` lines); `stats.spec.ts` PASS. |
| T-06-25 | Information Disclosure — doc encouraging unsafe config | Doc states redaction is default-on and gives export-before-prune guidance; no executable surface, low residual risk. | `docs/privacy-and-retention.md` (`Disabling redaction` section advises against it). |

---

## Unregistered Flags

None. No `## Threat Flags` section in any Phase 6 SUMMARY introduced new attack
surface without a mapped threat ID. `06-06-SUMMARY.md` explicitly records
"Threat Flags: None" and maps `redact-scan --apply` → T-06-22 and `stats`
reads → T-06-23. No new package installs were detected (`package.json` unchanged
during the phase), so no `unregistered_flag` was raised.

---

## Live Verification

`npx vitest run` over the 14 Phase 6 security test files:
**14 files / 103 tests passed.** Every `mitigate` threat whose disposition is
verified by a behavior/integration test was confirmed to pass, not merely to
exist.
