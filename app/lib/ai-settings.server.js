import prisma from "./db.server.js";
import { encrypt, decrypt } from "./crypto.server.js";

export const PROVIDERS = ["gemini", "claude"];

/**
 * Merchant-safe view of a shop's AI settings — never includes the key,
 * only enough to render the Settings page ("Gemini key ending in •••1234").
 */
export async function getShopAiSettings(shop) {
  const row = await prisma.shopAiSettings.findUnique({ where: { shop } });
  if (!row) return null;
  return {
    provider: row.provider,
    apiKeyLast4: row.apiKeyLast4,
    updatedAt: row.updatedAt,
  };
}

/**
 * Internal use only (ai-agent.js) — decrypts the merchant's own key so we
 * can call their chosen provider on their behalf. Never send this value
 * back to the client.
 */
export async function getDecryptedProviderCredentials(shop) {
  const row = await prisma.shopAiSettings.findUnique({ where: { shop } });
  if (!row) return null;
  return { provider: row.provider, apiKey: decrypt(row.encryptedApiKey) };
}

export async function saveShopAiSettings(shop, provider, apiKey) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Expected one of: ${PROVIDERS.join(", ")}`);
  }
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new Error("That doesn't look like a valid API key.");
  }

  return prisma.shopAiSettings.upsert({
    where: { shop },
    update: {
      provider,
      encryptedApiKey: encrypt(trimmed),
      apiKeyLast4: trimmed.slice(-4),
    },
    create: {
      shop,
      provider,
      encryptedApiKey: encrypt(trimmed),
      apiKeyLast4: trimmed.slice(-4),
    },
  });
}

export async function deleteShopAiSettings(shop) {
  await prisma.shopAiSettings.deleteMany({ where: { shop } });
}

export async function logAiUsage({
  shop,
  provider,
  model,
  inputTokens = 0,
  outputTokens = 0,
  estimatedCostUsd = 0,
  ok = true,
}) {
  await prisma.aiUsageLog.create({
    data: { shop, provider, model, inputTokens, outputTokens, estimatedCostUsd, ok },
  });
}

/** Totals for the Settings page usage panel. */
export async function getUsageSummary(shop) {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [allTime, last30d] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { shop },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { shop, createdAt: { gte: since30d } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
    }),
  ]);

  const shape = (agg) => ({
    requests: agg._count._all,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    estimatedCostUsd: agg._sum.estimatedCostUsd ?? 0,
  });

  return { allTime: shape(allTime), last30d: shape(last30d) };
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

/**
 * Simple per-shop rate limit for the chat endpoint, backed by AiUsageLog
 * (which we're already writing to for cost metering) rather than a
 * separate in-memory store — correct enough for a single-instance
 * deployment and self-clears as the window rolls forward.
 */
export async function isRateLimited(shop) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await prisma.aiUsageLog.count({
    where: { shop, createdAt: { gte: since } },
  });
  return count >= RATE_LIMIT_MAX_REQUESTS;
}
