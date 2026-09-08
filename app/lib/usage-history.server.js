import prisma from "./db.server.js";

/**
 * Increments today's usage counters for whatever SKUs appear in an
 * order's line items. Called from the orders webhook handler.
 *
 * Idempotency note: Shopify can and does redeliver webhooks. We don't
 * currently de-dupe by order ID here — for a v1 this is an acceptable
 * risk (occasional double-count on redelivery, self-corrects over time
 * as more days of data accumulate), but if you're shipping this for
 * real, add an OrderProcessed(shop, orderId) table and check it before
 * incrementing.
 */
export async function recordOrderUsage(shop, lineItems) {
  const today = startOfDay(new Date());

  for (const item of lineItems) {
    const sku = item.sku;
    if (!sku) continue; // skip line items with no SKU (bundles, tips, etc.)

    await prisma.dailyUsage.upsert({
      where: {
        shop_sku_date: { shop, sku, date: today },
      },
      update: {
        quantity: { increment: item.quantity },
      },
      create: {
        shop,
        sku,
        date: today,
        quantity: item.quantity,
      },
    });
  }
}

/**
 * Pulls the last N days of usage history for a SKU, filling gaps with
 * zero so the forecasting math (which expects a dense array) doesn't
 * misread "no data yet" as "no sales."
 */
export async function getUsageHistory(shop, sku, days = 30) {
  const since = startOfDay(new Date());
  since.setDate(since.getDate() - days);

  const rows = await prisma.dailyUsage.findMany({
    where: { shop, sku, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  const byDate = new Map(
    rows.map((r) => [r.date.toISOString().slice(0, 10), r.quantity]),
  );

  const history = [];
  const cursor = new Date(since);
  const now = startOfDay(new Date());

  while (cursor <= now) {
    const key = cursor.toISOString().slice(0, 10);
    history.push(byDate.get(key) ?? 0);
    cursor.setDate(cursor.getDate() + 1);
  }

  return history; // oldest first, matches forecasting.js expectations
}

/**
 * Fetches all SKUs a shop has recorded any usage for — the loader uses
 * this to know which SKUs to build a forecast for, instead of iterating
 * every inventory item (some of which may have zero sales history and
 * aren't worth forecasting yet).
 */
export async function getTrackedSkus(shop) {
  const rows = await prisma.dailyUsage.groupBy({
    by: ["sku"],
    where: { shop },
  });
  return rows.map((r) => r.sku);
}

/**
 * Per-SKU lead time, falling back to the shop-wide default, falling
 * back to a hardcoded 14 days if the merchant hasn't configured
 * anything yet (see the settings-page TODO in the README).
 */
export async function getLeadTimeDays(shop, sku) {
  const skuSetting = await prisma.leadTimeSetting.findUnique({
    where: { shop_sku_leadtime: { shop, sku } },
  });
  if (skuSetting) return skuSetting.leadTimeDays;

  const shopDefault = await prisma.leadTimeSetting.findFirst({
    where: { shop, sku: null },
  });
  if (shopDefault) return shopDefault.leadTimeDays;

  return 14;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
