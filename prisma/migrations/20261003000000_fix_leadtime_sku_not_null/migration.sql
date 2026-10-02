-- Fix: LeadTimeSetting.sku was nullable with "null = shop-wide default".
-- Prisma's generated WhereUniqueInput for the shop_sku_leadtime compound
-- unique index rejects a null value for sku at the validation layer
-- ("Argument `sku` must not be null"), so every attempt to save a
-- shop-wide default lead time (blank SKU) failed before it ever reached
-- the database. Switching the sentinel to "" (empty string) fixes this,
-- since "" is a normal, non-null value and compound unique lookups work
-- fine with it.

-- Backfill: convert any existing NULL skus to "" before adding NOT NULL.
-- (In practice there should be none, since every null-sku upsert always
-- threw and never persisted -- this is belt-and-suspenders.)
UPDATE "LeadTimeSetting" SET "sku" = '' WHERE "sku" IS NULL;

ALTER TABLE "LeadTimeSetting" ALTER COLUMN "sku" SET DEFAULT '';
ALTER TABLE "LeadTimeSetting" ALTER COLUMN "sku" SET NOT NULL;
