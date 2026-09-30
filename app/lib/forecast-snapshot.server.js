import { INVENTORY_LEVELS_QUERY } from "../graphql/queries.js";
import {
  calculateReorderPoint,
  daysOfCover,
  classifyStockStatus,
} from "./forecasting.js";
import { getUsageHistory, getLeadTimeDays } from "./usage-history.server.js";

/**
 * Builds the forecast snapshot from live Admin API + DB data. This is the
 * ONE place the snapshot gets built, used by both the dashboard loader
 * (app._index.jsx) and the AI chat endpoint (api.agent-chat.jsx) — the
 * chat endpoint used to trust a client-supplied snapshot, which let a
 * user hand the AI agent arbitrary fabricated data or prompt text.
 * Rebuilding it server-side here closes that.
 *
 * Paginates through every inventory item (not just the first 50) and
 * sums `available` quantity across every location returned for that item
 * (up to 10 locations/item — see queries.js), so multi-location shops get
 * an accurate total instead of "whatever the first location happened to
 * report." Items with no SKU are skipped: the forecasting engine is
 * inherently per-SKU, so there's nothing to compute for them.
 *
 * @param {number} maxItems - safety cap on total inventory items scanned
 *   per request (paginates in batches of 100). 2000 is generous for most
 *   merchants; a very large catalog will only get its first 2000 items
 *   forecasted per page load.
 */
export async function buildForecastSnapshot(admin, shop, { maxItems = 2000 } = {}) {
  const items = [];
  let cursor = null;

  while (items.length < maxItems) {
    const res = await admin.graphql(INVENTORY_LEVELS_QUERY, {
      variables: { first: 100, after: cursor },
    });
    const json = await res.json();
    const edges = json?.data?.inventoryItems?.edges ?? [];
    items.push(...edges);

    const pageInfo = json?.data?.inventoryItems?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return Promise.all(
    items
      .filter(({ node }) => !!node.sku)
      .map(async ({ node }) => {
        const locationEdges = node.inventoryLevels?.edges ?? [];
        const locations = locationEdges.map((edge) => ({
          id: edge.node.location?.id,
          name: edge.node.location?.name,
          available: edge.node.quantities?.[0]?.quantity ?? 0,
        }));
        const available = locations.reduce((sum, l) => sum + l.available, 0);

        const sku = node.sku;
        const leadTimeDays = await getLeadTimeDays(shop, sku);
        const history = await getUsageHistory(shop, sku, 30);

        const { avgDailyUsage, reorderPoint } = calculateReorderPoint({
          dailyUsageHistory: history,
          leadTimeDays,
        });

        const cover = daysOfCover(available, avgDailyUsage);
        const status = classifyStockStatus({
          daysOfCover: cover,
          leadTimeDays,
        });

        return {
          sku,
          title: node.variant?.displayName ?? sku,
          currentStock: available,
          locations,
          avgDailyUsage,
          daysOfCover: cover,
          reorderPoint,
          status,
          leadTimeDays,
          daysOfDataCollected: history.filter((h) => h > 0).length,
        };
      }),
  );
}
