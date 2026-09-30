-- CreateTable
CREATE TABLE "ShopProfile" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "shopName" TEXT,
    "ownerName" TEXT,
    "email" TEXT,
    "planName" TEXT,
    "country" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopProfile_shop_key" ON "ShopProfile"("shop");

-- CreateIndex
CREATE INDEX "Feedback_shop_idx" ON "Feedback"("shop");
