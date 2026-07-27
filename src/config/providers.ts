export const PROVIDER_IDS = ["claude-code", "gemini-cli", "codex"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderModelSettings {
  model?: string;
  effort?: EffortLevel;
  fallbackModel?: string;
}

export function defaultModelSettings(provider: ProviderId): ProviderModelSettings {
  return provider === "claude-code"
    ? { model: "sonnet", effort: "xhigh", fallbackModel: "opus" }
    : {};
}
