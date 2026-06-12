import {
  configFilePath,
  readPolicyConfig,
  writePolicyConfig,
  type PolicyConfig,
} from "../../core/config/policyConfig.js";

interface ConfigCommandOptions {
  /** Test seam: point at a temp config file instead of ~/.sessionmem/config.json. */
  configPath?: string;
}

/**
 * Maps operator-facing CLI keys to {@link PolicyConfig} fields plus a
 * type-coercion/validation step. Adding a new policy setting means adding one
 * entry here — no new per-setting command needed.
 *
 * `get` reads `field` from the effective config. `set` runs `coerce(value)`,
 * which returns the typed value or throws on an invalid input (the command then
 * exits 1 without writing).
 */
interface ConfigKeyDef {
  field: keyof PolicyConfig;
  coerce: (raw: string) => PolicyConfig[keyof PolicyConfig];
}

function coerceInt(raw: string): number {
  // Reject anything that is not a clean integer so we never persist NaN or
  // partial garbage (e.g. "30abc" -> 30 from parseInt is rejected here).
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`expected an integer, got "${raw}"`);
  }
  return Number.parseInt(raw.trim(), 10);
}

// 100 years (in days). Far beyond any realistic retention window, and keeps
// `Date.now() - retentionDays * 24 * 60 * 60 * 1000` well within the safe
// Date range so `pruneMemories`'s cutoff computation never throws RangeError.
// Exported so `retention prune --days` enforces the same
// bound as `config set retentionDays`.
export const MAX_RETENTION_DAYS = 36500;

function coerceRetentionDays(raw: string): number {
  const n = coerceInt(raw);
  if (n > MAX_RETENTION_DAYS) {
    throw new Error(`retentionDays must be <= ${MAX_RETENTION_DAYS}, got "${raw}"`);
  }
  return n;
}

function coerceBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`expected "true" or "false", got "${raw}"`);
}

// Accept both the dotted operator key (retention.days) and the raw policyConfig
// field name (retentionDays) so CLI and policyConfig stay consistent (plan note).
const CONFIG_KEYS: Record<string, ConfigKeyDef> = {
  "retention.days": { field: "retentionDays", coerce: coerceRetentionDays },
  retentionDays: { field: "retentionDays", coerce: coerceRetentionDays },
  redactionEnabled: { field: "redactionEnabled", coerce: coerceBool },
};

function resolvePath(options?: ConfigCommandOptions): string {
  return options?.configPath ?? configFilePath();
}

/**
 * `sessionmem config get <key>` — print the effective value for a known key.
 * Unknown key -> error + exit 1.
 */
export function configGetCommand(
  key: string,
  options?: ConfigCommandOptions,
): void {
  const def = CONFIG_KEYS[key];
  if (!def) {
    console.error(
      `Unknown config key "${key}". Known keys: ${Object.keys(CONFIG_KEYS).join(", ")}`,
    );
    process.exit(1);
    return;
  }

  const config = readPolicyConfig(resolvePath(options));
  console.log(String(config[def.field]));
}

/**
 * `sessionmem config set <key> <value>` — coerce and persist to config.json.
 * Unknown key or invalid value -> error + exit 1 with NO file write.
 */
export function configSetCommand(
  key: string,
  value: string,
  options?: ConfigCommandOptions,
): void {
  const def = CONFIG_KEYS[key];
  if (!def) {
    console.error(
      `Unknown config key "${key}". Known keys: ${Object.keys(CONFIG_KEYS).join(", ")}`,
    );
    process.exit(1);
    return;
  }

  let coerced: PolicyConfig[keyof PolicyConfig];
  try {
    coerced = def.coerce(value);
  } catch (err) {
    console.error(
      `Invalid value for "${key}": ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
    return;
  }

  writePolicyConfig(resolvePath(options), {
    [def.field]: coerced,
  } as Partial<PolicyConfig>);
  console.log(`Set ${key} = ${String(coerced)}`);
}
