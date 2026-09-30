-- Expiring offline access tokens: refresh token fields on Session
-- (required by @shopify/shopify-app-session-storage-prisma for
-- future.expiringOfflineAccessTokens in app/lib/shopify.server.js)
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenExpires" DATETIME;

CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- Idempotency baseline for the orders webhook (usage-history.server.js)
CREATE TABLE "ProcessedOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "lineItems" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProcessedOrder_shop_orderId_key" ON "ProcessedOrder"("shop", "orderId");
CREATE INDEX "ProcessedOrder_shop_idx" ON "ProcessedOrder"("shop");

-- Bring-your-own-key AI provider settings, encrypted at rest
CREATE TABLE "ShopAiSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "apiKeyLast4" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ShopAiSettings_shop_key" ON "ShopAiSettings"("shop");

-- AI usage/cost metering + rate limiting
CREATE TABLE "AiUsageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" REAL NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AiUsageLog_shop_createdAt_idx" ON "AiUsageLog"("shop", "createdAt");
