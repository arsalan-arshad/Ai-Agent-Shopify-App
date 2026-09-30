import { RECENT_ORDERS_QUERY } from "../graphql/queries.js";
import prisma from "./db.server.js";

/**
 * Seeds DailyUsage from the shop's existing order history on install,
 * so the forecast isn't useless for the first 30 days while the webhook
 * slowly accumulates fresh data. Triggered from app._index.jsx's loader
 * the first time a shop has zero tracked SKUs (see getTrackedSkus).
 *
 * Paginates through RECENT_ORDERS_QUERY. Admin API rate limits mean this
 * must not run inline in a request — it's called fire-and-forget and
 * logs its own errors; it's idempotent and safe to retry (upserts).
 *
 * Each backfilled order also gets a ProcessedOrder row recorded, with the
 * same { sku: quantity } snapshot shape the orders webhook uses
 * (usage-history.server.js). Without this, an orders/updated webhook that
 * later fires for an order this backfill already counted would have no
 * baseline to diff against and would double-count it.
 */
export async function backfillUsageHistory(admin, shop, { maxPages = 5 } = {}) {
  let cursor = null;
  let pagesRead = 0;
  const dailyTotals = new Map(); // key: `${sku}|${YYYY-MM-DD}` -> quantity
  const orderSnapshots = new Map(); // orderId -> { date, lineItems: { sku: quantity } }

  while (pagesRead < maxPages) {
    const response = await admin.graphql(RECENT_ORDERS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const json = await response.json();
    const edges = json?.data?.orders?.edges ?? [];

    for (const { node: order } of edges) {
      const day = order.createdAt.slice(0, 10); // YYYY-MM-DD
      const lineItemEdges = order.lineItems?.edges ?? [];
      const orderId = order.id;
      const lineItems = {};

      for (const { node: item } of lineItemEdges) {
        if (!item.sku) continue;
        const key = `${item.sku}|${day}`;
        dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + item.quantity);
        lineItems[item.sku] = (lineItems[item.sku] ?? 0) + item.quantity;
      }

      if (Object.keys(lineItems).length > 0) {
        orderSnapshots.set(orderId, { date: new Date(`${day}T00:00:00.000Z`), lineItems });
      }
    }

    const hasNext = json?.data?.orders?.pageInfo?.hasNextPage;
    if (!hasNext) break;

    cursor = edges[edges.length - 1]?.cursor ?? null;
    pagesRead += 1;
  }

  // Bulk upsert. Prisma doesn't have a native upsert-many, so this loops
  // — fine for a one-time backfill of a few thousand rows, not something
  // you'd want in a hot request path.
  for (const [key, quantity] of dailyTotals) {
    const [sku, day] = key.split("|");
    const date = new Date(`${day}T00:00:00.000Z`);

    await prisma.dailyUsage.upsert({
      where: { shop_sku_date: { shop, sku, date } },
      update: { quantity },
      create: { shop, sku, date, quantity },
    });
  }

  // Record a ProcessedOrder baseline for every backfilled order so a
  // later orders/updated webhook diffs against what we already counted
  // instead of re-adding it. Extract a numeric-ish order id from the GID
  // (gid://shopify/Order/12345 -> 12345) to match what the webhook payload
  // uses as `payload.id`.
  for (const [gid, snapshot] of orderSnapshots) {
    const orderId = gid.split("/").pop();
    await prisma.processedOrder.upsert({
      where: { shop_order: { shop, orderId } },
      update: { date: snapshot.date, lineItems: snapshot.lineItems },
      create: { shop, orderId, date: snapshot.date, lineItems: snapshot.lineItems },
    });
  }

  return {
    skusSeeded: new Set([...dailyTotals.keys()].map((k) => k.split("|")[0])).size,
    daysProcessed: dailyTotals.size,
    ordersSeeded: orderSnapshots.size,
  };
}
