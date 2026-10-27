import { test } from "node:test";
import assert from "node:assert/strict";
import {
  restockGap,
  unitsAtRisk,
  preorderRecommendation,
  revertRecommendation,
  formatPreorderSummary,
  preorderDisplayFigures,
  daysUntilRestock,
  isRestockDateStale,
  formatDayCount,
} from "../app/lib/preorder.js";

// README worked example (05-forecast-preorder-switch):
// SKU Y: 120 in stock · demand 8/day · restock in 29 days.
// Days of cover 15 → gap 14 → units at risk 112 → switch-on day 12.

test("README worked example: restockGap is 14", () => {
  assert.deepEqual(
    restockGap({ projectedStockoutDay: 15, restockDay: 29 }),
    { gapDays: 14 },
  );
});

test("README worked example: unitsAtRisk is 112", () => {
  assert.equal(unitsAtRisk({ dailyDemand: 8, gapDays: 14 }), 112);
});

test("README worked example: preorderRecommendation end to end", () => {
  const out = preorderRecommendation({
    stock: 120,
    dailyDemand: 8,
    restockDay: 29,
  });
  assert.deepEqual(out, {
    state: "candidate",
    switchOnDay: 12,
    gapDays: 14,
    unitsAtRisk: 112,
  });
});

test("restockGap is 0 when restock arrives before stockout", () => {
  assert.deepEqual(
    restockGap({ projectedStockoutDay: 30, restockDay: 20 }),
    { gapDays: 0 },
  );
});

test("restockGap is 0 when restock lands on the stockout day", () => {
  assert.deepEqual(
    restockGap({ projectedStockoutDay: 15, restockDay: 15 }),
    { gapDays: 0 },
  );
});

test("restockGap is 0 when there is no finite stockout (no demand)", () => {
  assert.deepEqual(
    restockGap({ projectedStockoutDay: Infinity, restockDay: 29 }),
    { gapDays: 0 },
  );
});

test("unitsAtRisk is 0 for non-positive demand or gap", () => {
  assert.equal(unitsAtRisk({ dailyDemand: 0, gapDays: 14 }), 0);
  assert.equal(unitsAtRisk({ dailyDemand: 8, gapDays: 0 }), 0);
  assert.equal(unitsAtRisk({ dailyDemand: -1, gapDays: 14 }), 0);
});

test("preorderRecommendation is none when there is no demand", () => {
  assert.deepEqual(
    preorderRecommendation({ stock: 120, dailyDemand: 0, restockDay: 29 }),
    { state: "none", switchOnDay: null, gapDays: 0, unitsAtRisk: 0 },
  );
});

test("preorderRecommendation is none when restock arrives before stockout", () => {
  assert.deepEqual(
    preorderRecommendation({ stock: 120, dailyDemand: 8, restockDay: 10 }),
    { state: "none", switchOnDay: null, gapDays: 0, unitsAtRisk: 0 },
  );
});

test("preorderRecommendation with zero stock is still a candidate", () => {
  const out = preorderRecommendation({
    stock: 0,
    dailyDemand: 8,
    restockDay: 10,
  });
  assert.equal(out.state, "candidate");
  assert.equal(out.gapDays, 10);
  assert.equal(out.unitsAtRisk, 80);
  // Already out of stock: switch on immediately (day 0), not a negative day.
  assert.equal(out.switchOnDay, 0);
});

test("preorderRecommendation respects a custom switchOnCoverDays", () => {
  const out = preorderRecommendation({
    stock: 120,
    dailyDemand: 8,
    restockDay: 29,
    switchOnCoverDays: 5,
  });
  assert.equal(out.switchOnDay, 10); // 15 - 5
});

test("revertRecommendation is false below the switch-off cover threshold", () => {
  // 48 / 8 = 6 days of cover < 7
  assert.equal(
    revertRecommendation({ stock: 48, dailyDemand: 8 }),
    false,
  );
});

test("revertRecommendation is true at the switch-off cover boundary", () => {
  // 56 / 8 = 7 days of cover exactly
  assert.equal(
    revertRecommendation({ stock: 56, dailyDemand: 8 }),
    true,
  );
});

test("revertRecommendation is true above the switch-off cover threshold", () => {
  assert.equal(
    revertRecommendation({ stock: 120, dailyDemand: 8 }),
    true,
  );
});

test("revertRecommendation is false with no demand or zero stock", () => {
  assert.equal(
    revertRecommendation({ stock: 120, dailyDemand: 0 }),
    false,
  );
  assert.equal(
    revertRecommendation({ stock: 0, dailyDemand: 8 }),
    false,
  );
});

test("hysteresis defaults: switch-off (7) > switch-on (3)", () => {
  // Same SKU can be a pre-order candidate while not yet a revert candidate.
  const rec = preorderRecommendation({
    stock: 32, // 4 days of cover
    dailyDemand: 8,
    restockDay: 20,
  });
  assert.equal(rec.state, "candidate");
  assert.equal(revertRecommendation({ stock: 32, dailyDemand: 8 }), false);

  // After restock brings cover back past 7 days, revert flips on.
  assert.equal(revertRecommendation({ stock: 64, dailyDemand: 8 }), true);
});

test("daysUntilRestock converts a calendar date to day offset", () => {
  const now = new Date(Date.UTC(2026, 9, 27)); // 2026-10-27
  assert.equal(daysUntilRestock("2026-11-25", now), 29);
  assert.equal(daysUntilRestock("2026-10-27", now), 0);
  assert.equal(daysUntilRestock(null, now), null);
});

test("formatPreorderSummary is null without a gap", () => {
  assert.equal(
    formatPreorderSummary({
      sku: "Y",
      restockDate: "2026-11-25",
      gapDays: 0,
      unitsAtRisk: 0,
      switchOnDay: null,
      daysOfCover: 30,
      avgDailyUsage: 8,
    }),
    null,
  );
});

test("formatPreorderSummary includes engine numbers for a candidate", () => {
  const text = formatPreorderSummary({
    sku: "Y",
    title: "Widget Y",
    restockDate: "2026-11-25",
    gapDays: 14,
    unitsAtRisk: 112,
    switchOnDay: 12,
    daysOfCover: 15,
    avgDailyUsage: 8,
  });
  assert.match(text, /SKU Y \(Widget Y\)|Y \(Widget Y\)/);
  assert.match(text, /112/);
  assert.match(text, /14 day/);
  assert.match(text, /2026-11-25/);
  assert.match(text, /day 12/);
});

test("preorderRecommendation accepts an explicit projectedStockoutDay", () => {
  // Pipeline-Aware hook: stock/demand would imply day 15, but the
  // inbound pipeline projects stockout on day 10 — gap should use 10.
  const out = preorderRecommendation({
    stock: 120,
    dailyDemand: 8,
    restockDay: 29,
    projectedStockoutDay: 10,
  });
  assert.equal(out.state, "candidate");
  assert.equal(out.gapDays, 19);
  assert.equal(out.switchOnDay, 7); // 10 - 3
  assert.equal(out.unitsAtRisk, 152); // 8 * 19
});

test("preorderRecommendation is none when projectedStockoutDay is Infinity", () => {
  assert.deepEqual(
    preorderRecommendation({
      stock: 120,
      dailyDemand: 8,
      restockDay: 29,
      projectedStockoutDay: Infinity,
    }),
    { state: "none", switchOnDay: null, gapDays: 0, unitsAtRisk: 0 },
  );
});

test("preorderRecommendation is none when projectedStockoutDay is NaN", () => {
  assert.deepEqual(
    preorderRecommendation({
      stock: 120,
      dailyDemand: 8,
      restockDay: 29,
      projectedStockoutDay: NaN,
    }),
    { state: "none", switchOnDay: null, gapDays: 0, unitsAtRisk: 0 },
  );
});

test("preorderRecommendation falls back to stock/demand when projectedStockoutDay is undefined", () => {
  const withOmitted = preorderRecommendation({
    stock: 120,
    dailyDemand: 8,
    restockDay: 29,
  });
  const withUndefined = preorderRecommendation({
    stock: 120,
    dailyDemand: 8,
    restockDay: 29,
    projectedStockoutDay: undefined,
  });
  assert.deepEqual(withOmitted, {
    state: "candidate",
    switchOnDay: 12,
    gapDays: 14,
    unitsAtRisk: 112,
  });
  assert.deepEqual(withUndefined, withOmitted);
});

test("formatDayCount rounds fractional day displays", () => {
  assert.equal(formatDayCount(11.857), "12");
  assert.equal(formatDayCount(14), "14");
  assert.equal(formatDayCount(Infinity), "—");
  assert.equal(formatDayCount(null), "—");
});

test("formatPreorderSummary and display figures use whole days and units", () => {
  // stock 120 / demand 7 ≈ 17.14 cover; restock day 29 → gap ≈ 11.86
  const rec = preorderRecommendation({
    stock: 120,
    dailyDemand: 7,
    restockDay: 29,
  });
  assert.equal(rec.state, "candidate");
  // Core math stays unrounded.
  assert.ok(rec.gapDays > 11 && rec.gapDays < 12);
  assert.ok(!Number.isInteger(rec.gapDays));

  const display = preorderDisplayFigures({
    daysOfCover: 120 / 7,
    gapDays: rec.gapDays,
    switchOnDay: rec.switchOnDay,
    avgDailyUsage: 7,
    restockDay: 29,
  });
  // Card adds up: cover 17 + gap 12 = restock 29; units from whole gap.
  assert.deepEqual(display, {
    cover: 17,
    gap: 12,
    switchOn: 14,
    restock: 29,
    units: 84,
  });

  const text = formatPreorderSummary({
    sku: "Y",
    restockDate: "2026-11-25",
    gapDays: rec.gapDays,
    switchOnDay: rec.switchOnDay,
    daysOfCover: 120 / 7,
    avgDailyUsage: 7,
    restockDay: 29,
  });
  assert.match(text, /day 17/);
  assert.match(text, /Gap: 12 days/);
  assert.match(text, /~84 units/);
  assert.match(text, /around day 14/);
  assert.doesNotMatch(text, /\d+\.\d+/);
});

test("formatPreorderSummary rounds fractional gap and switch-on days", () => {
  const text = formatPreorderSummary({
    sku: "Y",
    restockDate: "2026-11-25",
    gapDays: 11.857,
    unitsAtRisk: 95,
    switchOnDay: 8.142,
    daysOfCover: 11.142,
    avgDailyUsage: 8,
    restockDay: 23,
  });
  // 23 − 11 = 12 (endpoint gap), units = 8 * 12 = 96
  assert.match(text, /Gap: 12 days/);
  assert.match(text, /~96 units/);
  assert.match(text, /around day 8/);
  assert.match(text, /day 11/);
  assert.doesNotMatch(text, /11\.857/);
});

test("isRestockDateStale is true only for negative day offsets", () => {
  assert.equal(isRestockDateStale(-1), true);
  assert.equal(isRestockDateStale(0), false);
  assert.equal(isRestockDateStale(5), false);
  assert.equal(isRestockDateStale(null), false);
  assert.equal(isRestockDateStale(Infinity), false);
});

test("daysUntilRestock is negative when the date is in the past", () => {
  const now = new Date(Date.UTC(2026, 9, 27)); // 2026-10-27
  assert.equal(daysUntilRestock("2026-10-20", now), -7);
  assert.equal(isRestockDateStale(daysUntilRestock("2026-10-20", now)), true);
});
