import { RECENT_ORDERS_QUERY } from "../graphql/queries.js";
import prisma from "./db.server.js";

/**
 * Seeds DailyUsage from the shop's existing order history on install,
 * so the forecast isn't useless for the first 30 days while the webhook
 * slowly accumulates fresh data. Call this from an `app/uninstalled` /
 * `app/scopes_update` style hook, or a one-time route triggered right
 * after OAuth completes (e.g. in the app._index loader, if no DailyUsage
 * rows exist yet for this shop — check getTrackedSkus first).
 *
 * Paginates through RECENT_ORDERS_QUERY. Shopify Admin API rate limits
 * mean this should NOT run inline in a request — trigger it and return
 * immediately, then let it run as a background task (Remix doesn't have
 * a built-in job queue; for production, wire this to a simple queue or
 * even just a fire-and-forget promise with error logging, since it's
 * idempotent and safe to retry).
 */
export async function backfillUsageHistory(admin, shop, { maxPages = 5 } = {}) {
  let cursor = null;
  let pagesRead = 0;
  const dailyTotals = new Map(); // key: `${sku}|${YYYY-MM-DD}` -> quantity

  while (pagesRead < maxPages) {
    const response = await admin.graphql(RECENT_ORDERS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const json = await response.json();
    const edges = json?.data?.orders?.edges ?? [];

    for (const { node: order } of edges) {
      const day = order.createdAt.slice(0, 10); // YYYY-MM-DD
      const lineItemEdges = order.lineItems?.edges ?? [];

      for (const { node: item } of lineItemEdges) {
        if (!item.sku) continue;
        const key = `${item.sku}|${day}`;
        dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + item.quantity);
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

  return { skusSeeded: new Set([...dailyTotals.keys()].map((k) => k.split("|")[0])).size,
    daysProcessed: dailyTotals.size };
}
