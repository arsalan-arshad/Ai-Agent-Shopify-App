import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Answers a merchant's natural-language question about their forecast
 * data. The agent is grounded strictly in the forecastSnapshot passed in —
 * it never invents numbers, it explains and reasons over numbers the
 * deterministic engine (forecasting.js) already calculated.
 *
 * @param {string} question - merchant's natural language question
 * @param {object[]} forecastSnapshot - array of { sku, title, currentStock,
 *   avgDailyUsage, daysOfCover, reorderPoint, status }
 */
export async function askForecastAgent(question, forecastSnapshot) {
  const systemPrompt = `You are an inventory planning assistant embedded in a Shopify app.
You answer merchant questions ONLY using the forecast data provided below.
Never invent sales numbers, stock levels, or dates that aren't in the data.
If the data doesn't cover what's being asked, say so plainly and suggest
what data would be needed instead.
Keep answers short, concrete, and action-oriented — merchants are busy.
When you recommend an action (reorder now, order X units, etc.), name the
specific SKU and the number backing that recommendation.

Current forecast snapshot (JSON):
${JSON.stringify(forecastSnapshot, null, 2)}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: question,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
      thinkingConfig: {
        thinkingBudget: 128,
      },
    },
  });

  return response.text?.trim() || "I couldn't generate a response — please try rephrasing.";
}

/**
 * Generates a proactive daily digest ("what needs attention today") rather
 * than waiting for the merchant to ask. This is what makes the app feel
 * like an agent rather than a chatbot bolted onto a dashboard.
 */
export async function generateDailyDigest(forecastSnapshot) {
  const urgent = forecastSnapshot.filter((f) => f.status === "reorder_now");
  const soon = forecastSnapshot.filter((f) => f.status === "reorder_soon");

  if (urgent.length === 0 && soon.length === 0) {
    return "All SKUs are within healthy stock coverage today — no action needed.";
  }

  return askForecastAgent(
    "Summarize what needs attention today in 3-4 bullet points, prioritized by urgency.",
    forecastSnapshot,
  );
}
