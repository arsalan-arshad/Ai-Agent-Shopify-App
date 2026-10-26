-- CreateTable
CREATE TABLE "RestockDate" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "qty" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "switchOnCoverDays" INTEGER NOT NULL DEFAULT 3,
    "switchOffCoverDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreorderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestockDate_shop_idx" ON "RestockDate"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "RestockDate_shop_sku_key" ON "RestockDate"("shop", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderSetting_shop_key" ON "PreorderSetting"("shop");
