import { z } from "zod";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

/**
 * Built-in policy defaults. Used whenever the config file is missing, malformed,
 * or fails validation, and as the lowest-precedence source in
 * {@link resolvePolicySettings}.
 *
 * D-03: default retention window is 90 days.
 * D-06: redaction defaults on.
 */
export const DEFAULT_POLICY_CONFIG = {
  retentionDays: 90,
  redactionEnabled: true,
} as const;

/**
 * Field definitions shared between the read and write schemas. `.default()`
 * mirrors the pattern in src/core/api/contracts.ts so missing fields fall back to
 * built-in defaults.
 */
const policyConfigShape = {
  retentionDays: z.number().int().default(DEFAULT_POLICY_CONFIG.retentionDays),
  redactionEnabled: z.boolean().default(DEFAULT_POLICY_CONFIG.redactionEnabled),
};

/**
 * Strict schema for `~/.sessionmem/config.json`. `.strict()` rejects unknown keys
 * so caller-supplied writes cannot set unvalidated settings (threat T-06-04).
 */
export const policyConfigSchema = z.object(policyConfigShape).strict();

/**
 * Read schema. Unlike the write path, reading from disk STRIPS unknown keys
 * rather than rejecting the whole file. This keeps known-good values when a
 * config written by a newer binary carries fields this version doesn't know,
 * while still discarding unvalidated keys (threat T-06-04). Type-invalid known
 * fields still throw and trigger the safe-default fallback (threat T-06-02).
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
 * {@link DEFAULT_POLICY_CONFIG} without throwing (threat T-06-02). Stored values
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
 * rejected (throws) rather than silently written (threat T-06-04).
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

/**
 * Resolve effective settings using precedence override > config.json > default
 * (D-11). Each setting is resolved independently.
 */
export function resolvePolicySettings(input: ResolvePolicyInput): PolicyConfig {
  const resolve = <K extends keyof PolicyConfig>(key: K): PolicyConfig[K] => {
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
