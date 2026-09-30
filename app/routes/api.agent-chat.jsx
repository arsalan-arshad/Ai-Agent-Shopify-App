import { json } from "@remix-run/node";
import { authenticate } from "../lib/shopify.server.js";
import { askForecastAgent, NoApiKeyError } from "../lib/ai-agent.js";
import { buildForecastSnapshot } from "../lib/forecast-snapshot.server.js";
import { isRateLimited } from "../lib/ai-settings.server.js";

/**
 * The forecast snapshot is rebuilt HERE from the DB + Admin API, not
 * trusted from the client. The previous version accepted a
 * client-supplied `snapshot` form field and fed it straight into the AI
 * prompt, which let a user hand the agent arbitrary fabricated numbers or
 * injected instructions. Only `question` comes from the client now.
 */
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const question = formData.get("question");

  if (!question || typeof question !== "string") {
    return json({ error: "Question is required." }, { status: 400 });
  }

  if (await isRateLimited(shop)) {
    return json(
      { error: "You've hit the AI question limit for this minute — try again shortly." },
      { status: 429 },
    );
  }

  let forecastSnapshot;
  try {
    forecastSnapshot = await buildForecastSnapshot(admin, shop);
  } catch (err) {
    console.error("buildForecastSnapshot failed:", err);
    return json({ error: "Couldn't load your current inventory data. Please try again." }, { status: 502 });
  }

  try {
    const answer = await askForecastAgent(shop, question, forecastSnapshot);
    return json({ answer });
  } catch (err) {
    if (err instanceof NoApiKeyError) {
      return json(
        {
          needsSetup: true,
          error: "Add your Gemini or Claude API key in Settings to enable AI insights.",
        },
        { status: 200 },
      );
    }

    console.error("askForecastAgent failed:", err);
    const message =
      err?.status === 401 || err?.status === 403
        ? "AI agent is not configured correctly (invalid API key) — check it in Settings."
        : err?.status === 404
          ? "AI agent's model is unavailable — the model name may be outdated."
          : err?.status === 429
            ? "The AI provider hit a rate limit on your key. Please wait a moment and try again."
            : err?.status === 503
              ? "The AI provider is temporarily overloaded. Please try again in a moment."
              : "The AI agent couldn't answer right now. Please try again in a moment.";
    return json({ error: message }, { status: 502 });
  }
};
