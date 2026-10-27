import { INVENTORY_LEVELS_QUERY } from "../graphql/queries.js";
import {
  calculateReorderPoint,
  daysOfCover,
  classifyStockStatus,
} from "./forecasting.js";
import { getUsageHistory, getLeadTimeDays } from "./usage-history.server.js";
import {
  getPreorderSetting,
  listRestockDates,
} from "./preorder-settings.server.js";
import {
  preorderRecommendation,
  revertRecommendation,
  formatPreorderSummary,
  daysUntilRestock,
  isRestockDateStale,
} from "./preorder.js";
import {
  getReorderSetting,
  listSuppliers,
  listSkuSupplierTerms,
} from "./reorder-settings.server.js";
import {
  reorderRecommendation,
  buildDraftPo,
  rankByRevenueAtRisk,
  formatDraftPoText,
  formatDraftPoCsv,
} from "./reorder.js";

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
 * When the merchant has entered a restock date for a SKU, attaches a
 * `preorder` object built only from PR1 pure functions + that date + the
 * existing daysOfCover/demand numbers. With no restock dates configured,
 * items look exactly as they did before (no `preorder` field).
 *
 * When supplier terms exist (or shop reorder defaults apply), attaches a
 * `reorder` object from pure reorder.js math. Draft PO text/CSV is built
 * once for the whole snapshot (returned alongside items from
 * buildForecastSnapshotWithMeta — the plain array return keeps the
 * historical shape used by chat; the dashboard loader uses the meta
 * helper).
 *
 * @param {number} maxItems - safety cap on total inventory items scanned
 *   per request (paginates in batches of 100). 2000 is generous for most
 *   merchants; a very large catalog will only get its first 2000 items
 *   forecasted per page load.
 */
export async function buildForecastSnapshot(admin, shop, { maxItems = 2000 } = {}) {
  const { items } = await buildForecastSnapshotWithMeta(admin, shop, {
    maxItems,
  });
  return items;
}

/**
 * Same as buildForecastSnapshot, plus shop-level draft PO exports derived
 * only from numbers already on the items (no invented figures).
 *
 * @returns {Promise<{
 *   items: object[],
 *   draftPoText: string | null,
 *   draftPoCsv: string | null,
 *   atRisk: object[],
 * }>}
 */
export async function buildForecastSnapshotWithMeta(
  admin,
  shop,
  { maxItems = 2000 } = {},
) {
  const edges = await fetchInventoryEdges(admin, maxItems);

  // Batch-load restock dates, cover thresholds, and reorder terms once per
  // snapshot so we don't N+1 Prisma inside the per-SKU map below.
  const [
    restockRows,
    preorderSetting,
    reorderSetting,
    suppliers,
    termsRows,
  ] = await Promise.all([
    listRestockDates(shop),
    getPreorderSetting(shop),
    getReorderSetting(shop),
    listSuppliers(shop),
    listSkuSupplierTerms(shop),
  ]);
  const restockBySku = new Map(restockRows.map((r) => [r.sku, r]));
  const termsBySku = new Map(termsRows.map((r) => [r.sku, r]));
  const hasReorderConfig =
    suppliers.length > 0 || termsRows.length > 0 || !reorderSetting.isDefault;

  const items = await Promise.all(
    edges
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
        const terms = termsBySku.get(sku) ?? null;
        // Prefer per-SKU supplier lead time, then supplier default, then
        // existing LeadTimeSetting / shop default from usage-history.
        const fallbackLead = await getLeadTimeDays(shop, sku);
        const leadTimeDays =
          terms?.leadTimeDays ??
          terms?.supplier?.defaultLeadTimeDays ??
          fallbackLead;

        const history = await getUsageHistory(shop, sku, 30);

        const { avgDailyUsage, reorderPoint, safetyStock } =
          calculateReorderPoint({
            dailyUsageHistory: history,
            leadTimeDays,
            serviceLevelZ: reorderSetting.serviceLevelZ,
          });

        const cover = daysOfCover(available, avgDailyUsage);
        const status = classifyStockStatus({
          daysOfCover: cover,
          leadTimeDays,
        });

        const base = {
          sku,
          title: node.variant?.displayName ?? sku,
          currentStock: available,
          locations,
          avgDailyUsage,
          daysOfCover: cover,
          reorderPoint,
          safetyStock,
          status,
          leadTimeDays,
          daysOfDataCollected: history.filter((h) => h > 0).length,
        };

        let withPreorder = base;
        const restock = restockBySku.get(sku);
        if (restock) {
          const restockDay = daysUntilRestock(restock.date);
          const restockDateIso = toDateIso(restock.date);
          const recommendation = preorderRecommendation({
            stock: available,
            dailyDemand: avgDailyUsage,
            restockDay,
            switchOnCoverDays: preorderSetting.switchOnCoverDays,
          });
          const suggestRevert = revertRecommendation({
            stock: available,
            dailyDemand: avgDailyUsage,
            switchOffCoverDays: preorderSetting.switchOffCoverDays,
          });

          const summary = formatPreorderSummary({
            sku,
            title: base.title,
            restockDate: restockDateIso,
            gapDays: recommendation.gapDays,
            unitsAtRisk: recommendation.unitsAtRisk,
            switchOnDay: recommendation.switchOnDay,
            daysOfCover: cover,
            avgDailyUsage,
            restockDay,
          });

          withPreorder = {
            ...base,
            preorder: {
              restockDate: restockDateIso,
              restockQty: restock.qty ?? null,
              restockDay,
              staleRestockDate: isRestockDateStale(restockDay),
              switchOnCoverDays: preorderSetting.switchOnCoverDays,
              switchOffCoverDays: preorderSetting.switchOffCoverDays,
              recommendation,
              suggestRevert,
              summary,
            },
          };
        }

        // Attach reorder fields when the merchant has configured suppliers /
        // terms / defaults, or when stock status already says reorder.
        // Always attach when terms exist for this SKU so the dashboard can
        // show a quantity even for healthy cover.
        if (!hasReorderConfig && !terms) {
          return withPreorder;
        }

        const unitCost = terms?.unitCost ?? null;
        const recommendation = reorderRecommendation({
          dailyDemand: avgDailyUsage,
          leadTimeDays,
          reviewDays: reorderSetting.reviewDays,
          safetyStock,
          onHand: available,
          onOrder: 0,
          moq: terms?.moq ?? null,
          packSize: terms?.packSize ?? null,
          daysOfCover: cover,
          price: unitCost,
        });

        return {
          ...withPreorder,
          reorder: {
            reviewDays: reorderSetting.reviewDays,
            serviceLevelZ: reorderSetting.serviceLevelZ,
            supplierId: terms?.supplierId ?? null,
            supplierName: terms?.supplier?.name ?? null,
            moq: terms?.moq ?? null,
            packSize: terms?.packSize ?? null,
            unitCost,
            onOrder: 0,
            recommendation,
            shortfall: recommendation.shortfall,
          },
        };
      }),
  );

  const atRiskSource = items
    .filter((item) => (item.reorder?.shortfall?.unitsAtRisk ?? 0) > 0)
    .map((item) => ({
      sku: item.sku,
      title: item.title,
      shortfall: item.reorder.shortfall,
      orderQty: item.reorder.recommendation.orderQty,
      supplierName: item.reorder.supplierName,
      leadTimeDays: item.leadTimeDays,
      daysOfCover: item.daysOfCover,
    }));
  const atRisk = rankByRevenueAtRisk(atRiskSource);

  const draftLines = items
    .filter((item) => (item.reorder?.recommendation?.orderQty ?? 0) > 0)
    .map((item) => ({
      sku: item.sku,
      title: item.title,
      qty: item.reorder.recommendation.orderQty,
      unitCost: item.reorder.unitCost,
      supplierId: item.reorder.supplierId,
    }));
  const draftPos = buildDraftPo(
    draftLines,
    suppliers.map((s) => ({ id: s.id, name: s.name })),
  );

  return {
    items,
    draftPoText: formatDraftPoText(draftPos),
    draftPoCsv: formatDraftPoCsv(draftPos),
    atRisk,
  };
}

async function fetchInventoryEdges(admin, maxItems) {
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

  return items.slice(0, maxItems);
}

function toDateIso(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
