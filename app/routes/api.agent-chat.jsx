import { json } from "@remix-run/node";
import fs from "fs";
import { authenticate } from "../lib/shopify.server.js";
import { askForecastAgent } from "../lib/ai-agent.js";

const dlog = (msg) => {
  try {
    fs.appendFileSync("/tmp/agent-chat-debug.log", `${new Date().toISOString()} ${msg}\n`);
  } catch {}
};

export const action = async ({ request }) => {
  dlog("HIT action route");
  try {
    await authenticate.admin(request);
    dlog("authenticate.admin OK");
  } catch (authErr) {
    dlog(`authenticate.admin FAILED: ${authErr?.message ?? authErr}`);
    throw authErr;
  }

  const formData = await request.formData();
  const question = formData.get("question");
  const snapshot = JSON.parse(formData.get("snapshot") ?? "[]");
  dlog(`question=${question}`);

  if (!question || typeof question !== "string") {
    return json({ error: "Question is required." }, { status: 400 });
  }

  try {
    const answer = await askForecastAgent(question, snapshot);
    dlog(`answer received, length=${answer?.length}`);
    return json({ answer });
  } catch (err) {
    dlog(`askForecastAgent FAILED: status=${err?.status} message=${err?.message}`);
    console.error("askForecastAgent failed:", err);
    const message =
      err?.status === 401 || err?.status === 403
        ? "AI agent is not configured correctly (invalid or missing Gemini API key)."
        : err?.status === 404
          ? "AI agent's model is unavailable — the Gemini model name may be outdated."
          : err?.status === 429
            ? "AI agent hit its free-tier rate limit. Please wait a moment and try again."
            : "The AI agent couldn't answer right now. Please try again in a moment.";
    return json({ error: message }, { status: 502 });
  }
};
