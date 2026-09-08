/**
 * Core forecasting engine.
 *
 * This starts intentionally simple (weighted moving average + reorder
 * point math, both well-understood and explainable to merchants) rather
 * than a black-box ML model. The AI agent layer (ai-agent.js) sits on TOP
 * of these numbers to explain them and answer follow-up questions — the
 * agent should never be the sole source of a number a merchant will spend
 * money on. That split is what differentiates this from a "GPT wrapper"
 * app: the math is deterministic and auditable, the agent is the
 * conversational interface to it.
 */

/**
 * Weighted moving average, recent periods weighted more heavily.
 * @param {number[]} history - daily/weekly unit sales, oldest first
 * @param {number} periods - how many recent periods to weight
 */
export function weightedMovingAverage(history, periods = 4) {
  const recent = history.slice(-periods);
  if (recent.length === 0) return 0;

  const weights = recent.map((_, i) => i + 1); // e.g. [1,2,3,4]
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const weighted = recent.reduce(
    (sum, value, i) => sum + value * weights[i],
    0,
  );

  return weighted / weightSum;
}

/**
 * Reorder point = (avg daily usage * lead time in days) + safety stock.
 * Safety stock uses a simple standard-deviation buffer scaled by a
 * service-level factor (1.65 ≈ ~95% service level).
 */
export function calculateReorderPoint({
  dailyUsageHistory,
  leadTimeDays,
  serviceLevelZ = 1.65,
}) {
  const avgDailyUsage = weightedMovingAverage(dailyUsageHistory, 14);

  const mean =
    dailyUsageHistory.reduce((a, b) => a + b, 0) / dailyUsageHistory.length;
  const variance =
    dailyUsageHistory.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    dailyUsageHistory.length;
  const stdDev = Math.sqrt(variance);

  const safetyStock = serviceLevelZ * stdDev * Math.sqrt(leadTimeDays);
  const reorderPoint = avgDailyUsage * leadTimeDays + safetyStock;

  return {
    avgDailyUsage: round2(avgDailyUsage),
    safetyStock: round2(safetyStock),
    reorderPoint: round2(reorderPoint),
  };
}

/**
 * Days-of-cover: how many days until a SKU stocks out at current velocity.
 * This is the number merchants care about most day-to-day.
 */
export function daysOfCover(currentStock, avgDailyUsage) {
  if (avgDailyUsage <= 0) return Infinity;
  return round2(currentStock / avgDailyUsage);
}

/**
 * Flags a SKU for the dashboard / agent based on thresholds.
 */
export function classifyStockStatus({ daysOfCover, leadTimeDays }) {
  if (daysOfCover === Infinity) return "no_recent_sales";
  if (daysOfCover <= leadTimeDays) return "reorder_now";
  if (daysOfCover <= leadTimeDays * 1.5) return "reorder_soon";
  return "healthy";
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
