/**
 * Rough per-token pricing used only to show merchants an ESTIMATED cost
 * of their own AI usage on the Settings page. This is not a bill — the
 * merchant pays their AI provider directly with their own key. Prices
 * drift; if a model isn't listed, DEFAULT_RATE is used and the UI should
 * make clear the number is approximate.
 *
 * Update these against the provider's current pricing page before
 * treating them as anything more than a ballpark:
 *   Gemini:  https://ai.google.dev/pricing
 *   Claude:  https://docs.claude.com/en/docs/about-claude/pricing
 */
const PRICING_USD_PER_MILLION_TOKENS = {
  gemini: {
    "gemini-3.6-flash": { input: 0.1, output: 0.4 },
  },
  claude: {
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-haiku-5": { input: 0.8, output: 4 },
  },
};

const DEFAULT_RATE = { input: 1, output: 3 };

export function estimateCostUsd(provider, model, inputTokens, outputTokens) {
  const rate = PRICING_USD_PER_MILLION_TOKENS[provider]?.[model] ?? DEFAULT_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
