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
 * projectedStockoutDay defaults to stock / dailyDemand (days of cover).
 * Callers (e.g. Pipeline-Aware Forecast) may pass an explicit
 * projectedStockoutDay instead. switchOnDay = stockout day −
 * switchOnCoverDays (default: 3 days of cover left). state is
 * 'candidate' only when gapDays > 0.
 *
 * Math stays precise (floats OK). Round only at the display layer via
 * formatDayCount / formatPreorderSummary.
 *
 * @param {{
 *   stock: number,
 *   dailyDemand: number,
 *   restockDay: number,
 *   switchOnCoverDays?: number,
 *   projectedStockoutDay?: number,
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
  projectedStockoutDay: projectedStockoutDayInput,
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

  // Explicit non-finite stockout (Infinity = never stocks out, NaN) → none.
  // Fall back to stock/demand only when the argument is omitted (undefined).
  let projectedStockoutDay;
  if (projectedStockoutDayInput !== undefined) {
    if (!Number.isFinite(projectedStockoutDayInput)) {
      return none;
    }
    projectedStockoutDay = projectedStockoutDayInput;
  } else {
    projectedStockoutDay = stock / dailyDemand;
  }
  if (!(projectedStockoutDay >= 0)) {
    return none;
  }

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
 * True when the merchant's restock date is already in the past
 * (daysUntilRestock < 0). SPEC §6: stale dates should prompt an update.
 *
 * @param {number | null | undefined} restockDay
 * @returns {boolean}
 */
export function isRestockDateStale(restockDay) {
  return Number.isFinite(restockDay) && restockDay < 0;
}

/**
 * Round a day-count for merchant-facing copy (card, summary). Keeps
 * engine math pure; only presentation strings should call this.
 *
 * @param {number | null | undefined} n
 * @returns {string}
 */
export function formatDayCount(n) {
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

/**
 * Whole-number display figures for the recommendation card / summary.
 * Prefers gap = rounded(restock) − rounded(cover) when that still shows a
 * positive gap (so the card adds up); otherwise Math.round(gapDays).
 * For candidates (gapDays > 0) the displayed gap is never below 1, so a
 * fractional gap that rounds to 0 still shows at least one day.
 * unitsAtRisk is Math.round of demand × that whole-day gap.
 * Engine math in preorderRecommendation stays unrounded.
 *
 * @param {{
 *   daysOfCover: number,
 *   gapDays: number,
 *   switchOnDay: number | null | undefined,
 *   avgDailyUsage: number,
 *   restockDay?: number | null,
 * }} args
 * @returns {{
 *   cover: number,
 *   gap: number,
 *   switchOn: number | null,
 *   restock: number | null,
 *   units: number,
 * }}
 */
export function preorderDisplayFigures({
  daysOfCover,
  gapDays,
  switchOnDay,
  avgDailyUsage,
  restockDay,
}) {
  const cover = Math.round(daysOfCover);
  const gapRounded = Math.round(gapDays);
  const restock = Number.isFinite(restockDay) ? Math.round(restockDay) : null;
  const switchOn = Number.isFinite(switchOnDay) ? Math.round(switchOnDay) : null;
  const floorCandidateGap = (n) => (gapDays > 0 ? Math.max(1, n) : n);

  let gap = floorCandidateGap(gapRounded);
  if (restock != null && Number.isFinite(daysOfCover)) {
    const fromEndpoints = restock - cover;
    if (fromEndpoints > 0) {
      gap = floorCandidateGap(fromEndpoints);
    }
  }

  const units =
    Number.isFinite(avgDailyUsage) && avgDailyUsage > 0 && gap > 0
      ? Math.round(avgDailyUsage * gap)
      : 0;

  return { cover, gap, switchOn, restock, units };
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
 * Day counts and units are whole numbers from preorderDisplayFigures.
 *
 * @param {{
 *   sku: string,
 *   title?: string,
 *   restockDate: string,
 *   gapDays: number,
 *   unitsAtRisk?: number,
 *   switchOnDay: number,
 *   daysOfCover: number,
 *   avgDailyUsage: number,
 *   restockDay?: number | null,
 * }} args
 * @returns {string | null}
 */
export function formatPreorderSummary({
  sku,
  title,
  restockDate,
  gapDays,
  switchOnDay,
  daysOfCover,
  avgDailyUsage,
  restockDay,
}) {
  if (!(gapDays > 0) || !sku || !restockDate) return null;

  const label = title && title !== sku ? `${sku} (${title})` : sku;
  const demand = Number.isFinite(avgDailyUsage) ? round2(avgDailyUsage) : "n/a";
  const { cover, gap, switchOn, units } = preorderDisplayFigures({
    daysOfCover,
    gapDays,
    switchOnDay,
    avgDailyUsage,
    restockDay,
  });

  return [
    `Pre-order recommendation for ${label}`,
    `• Projected stockout: day ${cover} (≈${demand}/day demand)`,
    `• Restock expected: ${restockDate}`,
    `• Gap: ${gap} day${gap === 1 ? "" : "s"} · ~${units} units at risk`,
    `• Suggested switch-on: around day ${switchOn} (while cover remains)`,
    `• Paste into your pre-order app — Agent Forecast does not change your catalog.`,
  ].join("\n");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
