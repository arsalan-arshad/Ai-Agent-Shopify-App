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

/**
 * Days from `now` (UTC day) until the restock date. Negative if past.
 * Returns null when the date is missing/invalid. Pure — used by the
 * snapshot builder to turn a calendar date into the `restockDay` input
 * for preorderRecommendation.
 *
 * @param {Date | string | null | undefined} date
 * @param {Date} [now]
 * @returns {number | null}
 */
export function daysUntilRestock(date, now = new Date()) {
  if (date == null || date === "") return null;
  const target = startOfUtcDay(date);
  const today = startOfUtcDay(now);
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function startOfUtcDay(date) {
  if (date == null || date === "") return null;
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (m) {
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    }
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Plain-text summary a merchant can paste into their existing pre-order
 * app. Only includes numbers already computed by the engine — never
 * invents figures. Returns null when there is no candidate recommendation.
 *
 * @param {{
 *   sku: string,
 *   title?: string,
 *   restockDate: string,
 *   gapDays: number,
 *   unitsAtRisk: number,
 *   switchOnDay: number,
 *   daysOfCover: number,
 *   avgDailyUsage: number,
 * }} args
 * @returns {string | null}
 */
export function formatPreorderSummary({
  sku,
  title,
  restockDate,
  gapDays,
  unitsAtRisk,
  switchOnDay,
  daysOfCover,
  avgDailyUsage,
}) {
  if (!(gapDays > 0) || !sku || !restockDate) return null;

  const label = title && title !== sku ? `${sku} (${title})` : sku;
  const cover =
    Number.isFinite(daysOfCover) ? round2(daysOfCover) : "n/a";
  const demand = Number.isFinite(avgDailyUsage) ? round2(avgDailyUsage) : "n/a";
  const switchOn =
    Number.isFinite(switchOnDay) ? round2(switchOnDay) : "n/a";

  return [
    `Pre-order recommendation for ${label}`,
    `• Projected stockout: day ${cover} (≈${demand}/day demand)`,
    `• Restock expected: ${restockDate}`,
    `• Gap: ${gapDays} day${gapDays === 1 ? "" : "s"} · ~${unitsAtRisk} units at risk`,
    `• Suggested switch-on: around day ${switchOn} (while cover remains)`,
    `• Paste into your pre-order app — Agent Forecast does not change your catalog.`,
  ].join("\n");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
