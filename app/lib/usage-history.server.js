import prisma from "./db.server.js";
import { createQuantityForDelta, planOrderUsageUpdate } from "./order-usage.js";

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
 * Duplicates: ProcessedOrder stores the last { sku: quantity } snapshot we
 * recorded for this order. Each call applies only the delta between that
 * snapshot and the current line items (negative when a quantity dropped or
 * a line was removed). An unchanged delivery is a no-op.
 *
 * Out-of-order delivery: Shopify doesn't guarantee ordering, so each
 * delivery carries a version (sourceUpdatedAt: triggered-at header, else
 * payload updated_at) and a delivery older than the stored version is
 * skipped. The decision lives in the pure planOrderUsageUpdate
 * (order-usage.js).
 *
 * Concurrency: the whole read-plan-write runs in one interactive
 * transaction holding a row lock (SELECT ... FOR UPDATE) on the order's
 * ProcessedOrder row, so two simultaneous deliveries for one order are
 * serialized and the second plans against the first's committed state. A
 * lock was chosen over optimistic compare-and-set because it needs no retry
 * loop and also covers equal-version deliveries. A new order gets a
 * placeholder row (ON CONFLICT DO NOTHING) first so there is always a row to
 * lock; if the transaction fails the placeholder rolls back with it.
 *
 * Usage is attributed to the order's creation date (not "today" the
 * webhook happened to fire), which is what the forecasting math and the
 * backfill importer (backfill.server.js) both expect.
 *
 * @returns {Promise<{ action: "skip_stale" | "noop" | "apply" }>}
 */
// Interactive-transaction defaults (2s wait / 5s run) are tight when a burst
// of deliveries queues on one order's row lock.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export async function recordOrderUsage(
  shop,
  orderId,
  orderDate,
  lineItems,
  sourceUpdatedAt = null,
) {
  const date = startOfDay(orderDate);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "ProcessedOrder" ("shop", "orderId", "date", "lineItems", "updatedAt")
      VALUES (${shop}, ${orderId}, ${date}, '{}'::jsonb, NOW())
      ON CONFLICT ("shop", "orderId") DO NOTHING`;

    const [row] = await tx.$queryRaw`
      SELECT "lineItems", "sourceUpdatedAt" FROM "ProcessedOrder"
      WHERE "shop" = ${shop} AND "orderId" = ${orderId}
      FOR UPDATE`;

    // A placeholder or pre-migration row has a null version, which the
    // planner treats as applicable.
    const plan = planOrderUsageUpdate({
      previous: row,
      incoming: { lineItems, sourceUpdatedAt },
    });

    if (plan.action === "apply") {
      for (const { sku, delta } of plan.deltas) {
        await tx.dailyUsage.upsert({
          where: { shop_sku_date: { shop, sku, date } },
          update: { quantity: { increment: delta } },
          create: { shop, sku, date, quantity: createQuantityForDelta(delta) },
        });
      }
      await tx.processedOrder.update({
        where: { shop_order: { shop, orderId } },
        data: {
          date,
          lineItems: plan.nextSnapshot,
          sourceUpdatedAt: plan.nextSourceUpdatedAt,
        },
      });
    }

    return { action: plan.action };
  }, TX_OPTIONS);
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
