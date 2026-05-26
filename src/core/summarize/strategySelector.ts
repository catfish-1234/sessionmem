import type { HandleSessionEndRequest } from "../api/contracts.js";

export type SummarizerMode = "local" | "cloud";

export function resolveSummarizerMode(
  config: HandleSessionEndRequest["config"],
): SummarizerMode {
  if (
    config.allowCloudSummarization === true &&
    Boolean(config.anthropicApiKey)
  ) {
    return "cloud";
  }

  return "local";
}
