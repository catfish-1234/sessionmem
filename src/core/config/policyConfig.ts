import { z } from "zod";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

/** Lower bound of the 1-10 importance scale. */
export const MIN_IMPORTANCE = 1;

/** Upper bound of the 1-10 importance scale. */
export const MAX_IMPORTANCE = 10;

/** Importance threshold at or above which a warning is considered critical. */
export const CRITICAL_WARNING_IMPORTANCE_THRESHOLD = 9;

/** Maximum number of memories returned by a "deep" retrieval. */
export const DEEP_MODE_RETRIEVAL_CAP = 100;

/**
 * Default model for cloud summarization via the Anthropic API.
 * Consumed by {@link import("../summarize/cloudSummarizer.js").summarizeWithCloud}.
 */
export const DEFAULT_SUMMARIZER_MODEL = "claude-sonnet-4-6";

/**
 * Built-in policy defaults. Used whenever the config file is missing, malformed,
 * or fails validation, and as the lowest-precedence source in
 * {@link resolvePolicySettings}.
 *
 * The default retention window is 90 days, and redaction defaults on.
 */
export const DEFAULT_POLICY_CONFIG = {
  retentionDays: 90,
  redactionEnabled: true,
  team: { enabled: false },
} as const;

/**
 * Strict schema for the nested `team` section. `enabled` toggles team
 * mode; `sharedPath` points at the shared filesystem store the `sync` command
 * reads/writes. `.strict()` rejects unknown keys inside `team` so
 * unrecognized fields can't slip through; `.default()` keeps backward compat
 * for configs predating team mode (the section materializes as
 * `{ enabled: false }`).
 */
const teamConfigShape = z
  .object({
    enabled: z.boolean().default(false),
    sharedPath: z.string().optional(),
  })
  .strict();

/**
 * Field definitions shared between the read and write schemas. `.default()`
 * mirrors the pattern in src/core/api/contracts.ts so missing fields fall back to
 * built-in defaults.
 */
const policyConfigShape = {
  retentionDays: z.number().int().default(DEFAULT_POLICY_CONFIG.retentionDays),
  redactionEnabled: z.boolean().default(DEFAULT_POLICY_CONFIG.redactionEnabled),
  team: teamConfigShape.default({ enabled: false }),
};

/**
 * Strict schema for `~/.sessionmem/config.json`. `.strict()` rejects unknown keys
 * so caller-supplied writes cannot set unvalidated settings.
 */
export const policyConfigSchema = z.object(policyConfigShape).strict();

/**
 * Read schema. Unlike the write path, reading from disk STRIPS unknown keys
 * rather than rejecting the whole file. This keeps known-good values when a
 * config written by a newer binary carries fields this version doesn't know,
 * while still discarding unvalidated keys. Type-invalid known fields still
 * throw and trigger the safe-default fallback.
 */
const policyConfigReadSchema = z.object(policyConfigShape).strip();

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/**
 * Canonical config-file location, mirroring the `~/.sessionmem` dir convention in
 * src/cli/context.ts.
 */
export function configFilePath(): string {
  return join(homedir(), ".sessionmem", "config.json");
}

/**
 * Read and validate the policy config from disk.
 *
 * Defaults safely (like localOnlyPolicy.ts): any failure — missing file,
 * unreadable file, malformed JSON, or schema-invalid contents — returns
 * {@link DEFAULT_POLICY_CONFIG} without throwing. Stored values
 * are merged over defaults via the schema's per-field `.default()`.
 */
export function readPolicyConfig(filePath: string): PolicyConfig {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return policyConfigReadSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_POLICY_CONFIG };
  }
}

/**
 * Persist a partial policy config, merged over the current on-disk values (or
 * defaults when none exist). Creates parent directories as needed and writes
 * pretty-printed JSON.
 *
 * The partial is validated against the strict schema, so unknown keys are
 * rejected (throws) rather than silently written.
 */
export function writePolicyConfig(
  filePath: string,
  partial: Partial<PolicyConfig>,
): PolicyConfig {
  // Validate the caller-supplied partial first so unknown keys are rejected
  // before we touch the filesystem. `.partial()` keeps `.strict()` semantics.
  const validatedPartial = policyConfigSchema.partial().parse(partial);

  const current = readPolicyConfig(filePath);
  const merged = policyConfigSchema.parse({ ...current, ...validatedPartial });

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

export interface ResolvePolicyInput {
  /** Highest precedence — e.g. an explicit CLI flag. */
  override?: Partial<PolicyConfig>;
  /** Middle precedence — values read from config.json. */
  config?: Partial<PolicyConfig>;
}

/** Flat scalar policy settings — the only keys the per-key resolve loop owns. */
type ScalarPolicyKey = "retentionDays" | "redactionEnabled";
export type ScalarPolicySettings = Pick<PolicyConfig, ScalarPolicyKey>;

/**
 * Resolve effective FLAT settings using precedence override > config.json >
 * default. Each scalar setting is resolved independently.
 *
 * RESEARCH Pitfall 5: this loop assumes flat scalars. The nested `team` object
 * is deliberately NOT routed through here — use {@link resolveTeamConfig} for it.
 */
export function resolvePolicySettings(
  input: ResolvePolicyInput,
): ScalarPolicySettings {
  const resolve = <K extends ScalarPolicyKey>(key: K): PolicyConfig[K] => {
    const fromOverride = input.override?.[key];
    if (fromOverride !== undefined) return fromOverride;
    const fromConfig = input.config?.[key];
    if (fromConfig !== undefined) return fromConfig;
    return DEFAULT_POLICY_CONFIG[key];
  };

  return {
    retentionDays: resolve("retentionDays"),
    redactionEnabled: resolve("redactionEnabled"),
  };
}

/**
 * Maximum number of candidate rows loaded by `searchMemoryCandidates` before
 * cosine-similarity ranking. Rows are ordered by importance DESC, updated_at
 * DESC so the most relevant candidates are always included.
 *
 * TODO: Opt 3 will replace this LIMIT with importance/date WHERE clause
 */
export const MAX_SEMANTIC_CANDIDATES = 2000;

/**
 * Per-session write soft limit. When a session has stored at least this many
 * memories, subsequent storeMemory calls still succeed but the response
 * includes a "session_write_limit_warning" warningCode, giving the agent
 * feedback to stop storing excessive memories in a single session.
 */
export const SESSION_WRITE_SOFT_LIMIT = 50;

export type TeamConfig = PolicyConfig["team"];

export interface ResolveTeamInput {
  /** Highest precedence — e.g. an explicit override. */
  override?: TeamConfig;
  /** Middle precedence — the `team` section read from config.json. */
  config?: TeamConfig;
}

/**
 * Resolve the `team` config as a single object unit using precedence
 * override > config.json > default (RESEARCH Pitfall 5). Unlike
 * {@link resolvePolicySettings}, `team` is resolved whole — it is an object, not
 * a flat scalar, so it must never be fed through the per-key scalar loop.
 */
export function resolveTeamConfig(input: ResolveTeamInput): TeamConfig {
  if (input.override !== undefined) return input.override;
  if (input.config !== undefined) return input.config;
  return { ...DEFAULT_POLICY_CONFIG.team };
}
