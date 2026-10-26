import { test } from "node:test";
import assert from "node:assert/strict";
import {
  restockGap,
  unitsAtRisk,
  preorderRecommendation,
  revertRecommendation,
  formatPreorderSummary,
  daysUntilRestock,
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
