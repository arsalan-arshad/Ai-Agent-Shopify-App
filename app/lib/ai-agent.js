import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { getDecryptedProviderCredentials, logAiUsage } from "./ai-settings.server.js";
import { estimateCostUsd } from "./ai-pricing.js";

const GEMINI_MODEL = "gemini-3.6-flash";
const CLAUDE_MODEL = "claude-sonnet-5";

/** Thrown when a shop hasn't configured an AI provider key yet. The chat
 * route catches this specifically to show a setup prompt instead of a
 * generic error. */
export class NoApiKeyError extends Error {
  constructor() {
    super("No AI provider is configured for this shop yet.");
    this.name = "NoApiKeyError";
  }
}

function buildSystemPrompt(forecastSnapshot) {
  return `You are an inventory planning assistant embedded in a Shopify app.
You answer merchant questions ONLY using the forecast data provided below.
Never invent sales numbers, stock levels, or dates that aren't in the data.
If the data doesn't cover what's being asked, say so plainly and suggest
what data would be needed instead.
Keep answers short, concrete, and action-oriented — merchants are busy.
When you recommend an action (reorder now, order X units, etc.), name the
specific SKU and the number backing that recommendation.

Current forecast snapshot (JSON):
${JSON.stringify(forecastSnapshot, null, 2)}`;
}

async function callGemini(apiKey, question, systemPrompt) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: question,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 128 },
    },
  });

  return {
    text: response.text?.trim() || "I couldn't generate a response — please try rephrasing.",
    model: GEMINI_MODEL,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callClaude(apiKey, question, systemPrompt) {
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  const text = response.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    text: text || "I couldn't generate a response — please try rephrasing.",
    model: CLAUDE_MODEL,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

/**
 * Answers a merchant's natural-language question about their forecast
 * data, using whichever provider (Gemini or Claude) the merchant
 * configured with their own API key (app.settings.jsx / ai-settings.server.js).
 * There is no shared/fallback key — if the shop hasn't configured one,
 * this throws NoApiKeyError.
 *
 * The agent is grounded strictly in the forecastSnapshot passed in — it
 * never invents numbers, it explains and reasons over numbers the
 * deterministic engine (forecasting.js) already calculated.
 */
export async function askForecastAgent(shop, question, forecastSnapshot) {
  const credentials = await getDecryptedProviderCredentials(shop);
  if (!credentials) throw new NoApiKeyError();

  const systemPrompt = buildSystemPrompt(forecastSnapshot);
  const caller = credentials.provider === "claude" ? callClaude : callGemini;

  let result;
  let ok = true;
  try {
    result = await caller(credentials.apiKey, question, systemPrompt);
    return result.text;
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    if (result || !ok) {
      const model = result?.model ?? (credentials.provider === "claude" ? CLAUDE_MODEL : GEMINI_MODEL);
      const inputTokens = result?.inputTokens ?? 0;
      const outputTokens = result?.outputTokens ?? 0;
      await logAiUsage({
        shop,
        provider: credentials.provider,
        model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(credentials.provider, model, inputTokens, outputTokens),
        ok,
      }).catch((logErr) => console.error("logAiUsage failed:", logErr));
    }
  }
}

/**
 * Generates a proactive daily digest ("what needs attention today") rather
 * than waiting for the merchant to ask.
 */
export async function generateDailyDigest(shop, forecastSnapshot) {
  const urgent = forecastSnapshot.filter((f) => f.status === "reorder_now");
  const soon = forecastSnapshot.filter((f) => f.status === "reorder_soon");

  if (urgent.length === 0 && soon.length === 0) {
    return "All SKUs are within healthy stock coverage today — no action needed.";
  }

  return askForecastAgent(
    shop,
    "Summarize what needs attention today in 3-4 bullet points, prioritized by urgency.",
    forecastSnapshot,
  );
}
