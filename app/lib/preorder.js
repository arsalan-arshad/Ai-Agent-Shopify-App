/**
 * Pre-order switch recommendations (v0 math).
 *
 * Pure / deterministic — no I/O, Prisma, Shopify, or AI. Numbers here feed
 * a later recommendation card; the agent may only explain them.
 *
 * Formulas and the worked example live in the planning blueprint:
 * ../05-forecast-preorder-switch/README.md and docs/SPEC.md
 */

/**
 * Gap between projected stockout and expected restock, in days.
 * Zero when restock arrives first, on the stockout day, or when there is
 * no meaningful stockout (e.g. Infinite / non-finite projected day).
 *
 * @param {{ projectedStockoutDay: number, restockDay: number }} args
 * @returns {{ gapDays: number }}
 */
export function restockGap({ projectedStockoutDay, restockDay }) {
  if (!Number.isFinite(projectedStockoutDay) || !Number.isFinite(restockDay)) {
    return { gapDays: 0 };
  }
  return { gapDays: Math.max(0, restockDay - projectedStockoutDay) };
}

/**
 * Estimated demand that walks away during the gap.
 * Same daily demand the forecast engine already uses (WMA etc.).
 *
 * @param {{ dailyDemand: number, gapDays: number }} args
 * @returns {number}
 */
export function unitsAtRisk({ dailyDemand, gapDays }) {
  if (!(dailyDemand > 0) || !(gapDays > 0)) return 0;
  return round2(dailyDemand * gapDays);
}

/**
 * Whether / when to suggest switching a SKU to pre-order.
 *
 * projectedStockoutDay = stock / dailyDemand (days of cover).
 * switchOnDay = stockout day − switchOnCoverDays (default: 3 days of
 * cover left). state is 'candidate' only when gapDays > 0.
 *
 * @param {{
 *   stock: number,
 *   dailyDemand: number,
 *   restockDay: number,
 *   switchOnCoverDays?: number,
 * }} args
 * @returns {{
 *   state: 'none' | 'candidate',
 *   switchOnDay: number | null,
 *   gapDays: number,
 *   unitsAtRisk: number,
 * }}
 */
export function preorderRecommendation({
  stock,
  dailyDemand,
  restockDay,
  switchOnCoverDays = 3,
}) {
  const none = {
    state: "none",
    switchOnDay: null,
    gapDays: 0,
    unitsAtRisk: 0,
  };

  if (!(dailyDemand > 0) || !Number.isFinite(restockDay)) {
    return none;
  }
  if (!Number.isFinite(stock) || stock < 0) {
    return none;
  }
  if (!Number.isFinite(switchOnCoverDays) || switchOnCoverDays < 0) {
    return none;
  }

  const projectedStockoutDay = stock / dailyDemand;
  const { gapDays } = restockGap({ projectedStockoutDay, restockDay });
  if (gapDays <= 0) return none;

  return {
    state: "candidate",
    switchOnDay: Math.max(0, projectedStockoutDay - switchOnCoverDays),
    gapDays,
    unitsAtRisk: unitsAtRisk({ dailyDemand, gapDays }),
  };
}

/**
 * Whether to recommend switching back from pre-order once stock returns.
 *
 * True when days of cover >= switchOffCoverDays (default 7). Defaults are
 * intentionally higher than switch-on (3) so a product never flaps —
 * hysteresis lives in the threshold pair, not in a separate state machine.
 *
 * @param {{
 *   stock: number,
 *   dailyDemand: number,
 *   switchOffCoverDays?: number,
 * }} args
 * @returns {boolean}
 */
export function revertRecommendation({
  stock,
  dailyDemand,
  switchOffCoverDays = 7,
}) {
  if (!(dailyDemand > 0) || !Number.isFinite(stock) || stock < 0) {
    return false;
  }
  if (!Number.isFinite(switchOffCoverDays) || switchOffCoverDays < 0) {
    return false;
  }
  return stock / dailyDemand >= switchOffCoverDays;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
