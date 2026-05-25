import { DomainError } from "./errors.js";

export interface ProviderPolicyConfig {
  enabled?: boolean;
  mode?: "local" | "cloud" | "external";
  provider?: string;
}

export interface LocalOnlyPolicyConfig {
  localOnly?: boolean;
  allowExternalProviders?: boolean;
  providers?: Record<string, ProviderPolicyConfig | undefined>;
}

function isExternalProviderEnabled(config: ProviderPolicyConfig): boolean {
  if (!config.enabled) {
    return false;
  }

  if (config.mode && config.mode !== "local") {
    return true;
  }

  if (config.provider) {
    return config.provider !== "local";
  }

  return true;
}

export function assertLocalOnlyPolicy(config: LocalOnlyPolicyConfig): void {
  const localOnly = config.localOnly ?? true;
  if (!localOnly) {
    return;
  }

  if (config.allowExternalProviders) {
    return;
  }

  const enabledExternalProviders = Object.entries(config.providers ?? {})
    .filter(([, providerConfig]) => providerConfig)
    .filter(([, providerConfig]) =>
      isExternalProviderEnabled(providerConfig as ProviderPolicyConfig),
    )
    .map(([name]) => name);

  if (enabledExternalProviders.length > 0) {
    throw new DomainError(
      "VALIDATION",
      `Local-only mode blocks external providers: ${enabledExternalProviders.join(", ")}. Set allowExternalProviders=true for explicit opt-in.`,
    );
  }
}
