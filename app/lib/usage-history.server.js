import prisma from "./db.server.js";

/**
 * Records (or re-reconciles) usage for one order's line items, keyed by
 * order ID so repeated/edited orders/updated deliveries don't double-count.
 *
 * Shopify redelivers webhooks, and orders/updated fires on nearly any edit
 * to an order (address change, note, tag, fulfillment, line-item quantity
 * change, etc.) — not just ones that actually change what was sold. Naively
 * re-adding the full line-item quantities on every delivery inflates
 * DailyUsage without bound.
 *
 * Fix: ProcessedOrder stores the last { sku: quantity } snapshot we
 * recorded for this order. Each call computes the delta between that
 * snapshot and the current line items and applies only the delta to
 * DailyUsage (which can be negative, e.g. a line item's quantity was
 * reduced or removed). A delivery with unchanged line items is a no-op.
 *
 * Usage is attributed to the order's creation date (not "today" the
 * webhook happened to fire), which is what the forecasting math and the
 * backfill importer (backfill.server.js) both expect.
 */
export async function recordOrderUsage(shop, orderId, orderDate, lineItems) {
  const date = startOfDay(orderDate);

  // Aggregate line items by SKU (an order can have multiple line items
  // for the same SKU) and drop items with no SKU (bundles, tips, etc.)
  const currentMap = {};
  for (const item of lineItems) {
    if (!item.sku) continue;
    currentMap[item.sku] = (currentMap[item.sku] ?? 0) + (item.quantity ?? 0);
  }

  const previous = await prisma.processedOrder.findUnique({
    where: { shop_order: { shop, orderId } },
  });
  const previousMap = previous?.lineItems ?? {};

  const skus = new Set([...Object.keys(currentMap), ...Object.keys(previousMap)]);
  const deltas = [];
  for (const sku of skus) {
    const delta = (currentMap[sku] ?? 0) - (previousMap[sku] ?? 0);
    if (delta !== 0) deltas.push({ sku, delta });
  }

  if (deltas.length === 0 && previous) {
    // Nothing changed since the last delivery for this order — no-op.
    return;
  }

  await prisma.$transaction([
    ...deltas.map(({ sku, delta }) =>
      prisma.dailyUsage.upsert({
        where: { shop_sku_date: { shop, sku, date } },
        update: { quantity: { increment: delta } },
        // If this is a net-negative delta with no existing row (shouldn't
        // normally happen), clamp at 0 rather than creating a negative count.
        create: { shop, sku, date, quantity: Math.max(delta, 0) },
      }),
    ),
    prisma.processedOrder.upsert({
      where: { shop_order: { shop, orderId } },
      update: { date, lineItems: currentMap },
      create: { shop, orderId, date, lineItems: currentMap },
    }),
  ]);
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
 * anything yet.
 */
export async function getLeadTimeDays(shop, sku) {
  const skuSetting = sku
    ? await prisma.leadTimeSetting.findUnique({
        where: { shop_sku_leadtime: { shop, sku } },
      })
    : null;
  if (skuSetting) return skuSetting.leadTimeDays;

  // Shop-wide default row is stored with sku: "" (not null) -- see
  // setLeadTimeDays below.
  const shopDefault = await prisma.leadTimeSetting.findUnique({
    where: { shop_sku_leadtime: { shop, sku: "" } },
  });
  if (shopDefault) return shopDefault.leadTimeDays;

  return 14;
}

/**
 * Upserts a lead-time setting (shop-wide default when sku is blank, per-SKU
 * otherwise). Used by the Settings page (app.settings.jsx).
 *
 * sku is normalized to "" for the shop-wide default -- never null. Prisma's
 * generated WhereUniqueInput for the shop_sku_leadtime compound unique index
 * rejects null for a member field at the validation layer ("Argument `sku`
 * must not be null"), so passing null here always threw before reaching the
 * database. "" is a normal, non-null value and works fine as the sentinel.
 */
export async function setLeadTimeDays(shop, sku, leadTimeDays, supplierName = null) {
  const normalizedSku = sku ?? "";
  return prisma.leadTimeSetting.upsert({
    where: { shop_sku_leadtime: { shop, sku: normalizedSku } },
    update: { leadTimeDays, supplierName },
    create: { shop, sku: normalizedSku, leadTimeDays, supplierName },
  });
}

export async function listLeadTimeSettings(shop) {
  return prisma.leadTimeSetting.findMany({
    where: { shop },
    orderBy: [{ sku: "asc" }],
  });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
