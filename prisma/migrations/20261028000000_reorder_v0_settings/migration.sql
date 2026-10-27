-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuSupplierTerms" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "leadTimeDays" INTEGER,
    "moq" INTEGER,
    "packSize" INTEGER,
    "unitCost" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuSupplierTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewDays" INTEGER NOT NULL DEFAULT 14,
    "serviceLevelZ" DOUBLE PRECISION NOT NULL DEFAULT 1.65,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReorderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_shop_idx" ON "Supplier"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shop_name_key" ON "Supplier"("shop", "name");

-- CreateIndex
CREATE INDEX "SkuSupplierTerms_shop_idx" ON "SkuSupplierTerms"("shop");

-- CreateIndex
CREATE INDEX "SkuSupplierTerms_supplierId_idx" ON "SkuSupplierTerms"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SkuSupplierTerms_shop_sku_key" ON "SkuSupplierTerms"("shop", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderSetting_shop_key" ON "ReorderSetting"("shop");

-- AddForeignKey
ALTER TABLE "SkuSupplierTerms" ADD CONSTRAINT "SkuSupplierTerms_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
