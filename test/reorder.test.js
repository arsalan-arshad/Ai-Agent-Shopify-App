import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderUpToLevel,
  rawOrderQty,
  applyMoqAndPack,
  shortfall,
  reorderRecommendation,
  buildDraftPo,
  rankByRevenueAtRisk,
  formatDraftPoText,
  formatDraftPoCsv,
} from "../app/lib/reorder.js";
import { calculateReorderPoint } from "../app/lib/forecasting.js";

// README worked example (07-reorder-brain):
// SKU X: 150 on hand · 0 on order · demand 8/day · lead time 21 days ·
// daily stdDev 3 · review 14 · MOQ 200 · pack 24 · price $30.
// Safety stock z=1.65: 1.65 × 3 × √21 ≈ 22.7
// Order-up-to: 8 × (21+14) + 22.7 ≈ 302.7
// Raw: 302.7 − 150 ≈ 152.7 → after MOQ 200 → after pack 216
// Shortfall: 21 − 18.75 = 2.25 days → 18 units → $540

const README_SAFETY = 1.65 * 3 * Math.sqrt(21); // ≈ 22.6837…

test("README worked example: orderUpToLevel ≈ 302.7", () => {
  const out = orderUpToLevel({
    dailyDemand: 8,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: README_SAFETY,
  });
  assert.equal(out, Math.round((8 * 35 + README_SAFETY) * 100) / 100);
  assert.ok(Math.abs(out - 302.7) < 0.05);
});

test("README worked example: rawOrderQty ≈ 152.7", () => {
  const orderUpTo = orderUpToLevel({
    dailyDemand: 8,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: README_SAFETY,
  });
  const raw = rawOrderQty({ orderUpTo, onHand: 150, onOrder: 0 });
  assert.ok(Math.abs(raw - 152.7) < 0.05);
});

test("README worked example: applyMoqAndPack → 216", () => {
  const orderUpTo = orderUpToLevel({
    dailyDemand: 8,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: README_SAFETY,
  });
  const raw = rawOrderQty({ orderUpTo, onHand: 150, onOrder: 0 });
  assert.equal(applyMoqAndPack({ qty: raw, moq: 200, packSize: 24 }), 216);
});

test("README worked example: shortfall → 18 units / $540", () => {
  const out = shortfall({
    daysOfCover: 18.75, // 150 / 8
    leadTimeDays: 21,
    dailyDemand: 8,
    price: 30,
  });
  assert.equal(out.gapDays, 2.25);
  assert.equal(out.unitsAtRisk, 18);
  assert.equal(out.revenueAtRisk, 540);
});

test("README worked example: reorderRecommendation end to end", () => {
  const out = reorderRecommendation({
    dailyDemand: 8,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: README_SAFETY,
    onHand: 150,
    onOrder: 0,
    moq: 200,
    packSize: 24,
    daysOfCover: 18.75,
    price: 30,
  });
  assert.equal(out.orderQty, 216);
  assert.equal(out.shortfall.unitsAtRisk, 18);
  assert.equal(out.shortfall.revenueAtRisk, 540);
  assert.equal(out.needsReorder, true);
});

test("README safety stock matches calculateReorderPoint shape (z=1.65)", () => {
  // Constant daily demand 8 with stdDev ≈ 3: build a history whose sample
  // stdDev is 3 so forecasting.js safety stock ≈ README figure.
  // Mean 8, variance 9 → stdDev 3. Use values that average to 8 with σ=3.
  const history = [5, 11, 5, 11, 5, 11]; // mean 8, pop variance = 9 → σ = 3
  const { safetyStock } = calculateReorderPoint({
    dailyUsageHistory: history,
    leadTimeDays: 21,
    serviceLevelZ: 1.65,
  });
  assert.ok(Math.abs(safetyStock - README_SAFETY) < 0.1);
});

test("orderUpToLevel is 0 with zero demand", () => {
  assert.equal(
    orderUpToLevel({
      dailyDemand: 0,
      leadTimeDays: 21,
      reviewDays: 14,
      safetyStock: 22.7,
    }),
    0,
  );
});

test("rawOrderQty is never negative", () => {
  assert.equal(rawOrderQty({ orderUpTo: 100, onHand: 150, onOrder: 0 }), 0);
  assert.equal(rawOrderQty({ orderUpTo: 100, onHand: 50, onOrder: 60 }), 0);
  assert.equal(rawOrderQty({ orderUpTo: 100, onHand: 40, onOrder: 10 }), 50);
});

test("rawOrderQty treats missing onOrder as 0", () => {
  assert.equal(rawOrderQty({ orderUpTo: 100, onHand: 40 }), 60);
});

test("applyMoqAndPack: qty 0 stays 0 (does not bump to MOQ)", () => {
  assert.equal(applyMoqAndPack({ qty: 0, moq: 200, packSize: 24 }), 0);
});

test("applyMoqAndPack: MOQ larger than need", () => {
  assert.equal(applyMoqAndPack({ qty: 50, moq: 200, packSize: 1 }), 200);
});

test("applyMoqAndPack: pack size alone rounds up", () => {
  assert.equal(applyMoqAndPack({ qty: 50, moq: null, packSize: 24 }), 72);
});

test("applyMoqAndPack: huge pack size", () => {
  assert.equal(applyMoqAndPack({ qty: 10, moq: 1, packSize: 1000 }), 1000);
});

test("applyMoqAndPack: missing terms leaves qty unchanged", () => {
  assert.equal(applyMoqAndPack({ qty: 153, moq: null, packSize: null }), 153);
});

test("shortfall is zero when cover >= lead time", () => {
  assert.deepEqual(
    shortfall({
      daysOfCover: 30,
      leadTimeDays: 21,
      dailyDemand: 8,
      price: 30,
    }),
    { gapDays: 0, unitsAtRisk: 0, revenueAtRisk: 0 },
  );
});

test("shortfall is zero with infinite cover (no demand)", () => {
  assert.deepEqual(
    shortfall({
      daysOfCover: Infinity,
      leadTimeDays: 21,
      dailyDemand: 8,
      price: 30,
    }),
    { gapDays: 0, unitsAtRisk: 0, revenueAtRisk: 0 },
  );
});

test("shortfall is zero with zero demand", () => {
  assert.deepEqual(
    shortfall({
      daysOfCover: 5,
      leadTimeDays: 21,
      dailyDemand: 0,
      price: 30,
    }),
    { gapDays: 0, unitsAtRisk: 0, revenueAtRisk: 0 },
  );
});

test("shortfall with zero / missing price still reports units", () => {
  const out = shortfall({
    daysOfCover: 10,
    leadTimeDays: 20,
    dailyDemand: 5,
    price: null,
  });
  assert.equal(out.gapDays, 10);
  assert.equal(out.unitsAtRisk, 50);
  assert.equal(out.revenueAtRisk, 0);
});

test("reorderRecommendation with zero stock still needs reorder", () => {
  const out = reorderRecommendation({
    dailyDemand: 8,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: 22.7,
    onHand: 0,
    daysOfCover: 0,
    price: 30,
  });
  assert.ok(out.orderQty > 0);
  assert.equal(out.needsReorder, true);
  assert.equal(out.shortfall.unitsAtRisk, 168); // 21 * 8
});

test("reorderRecommendation with zero demand needs nothing", () => {
  const out = reorderRecommendation({
    dailyDemand: 0,
    leadTimeDays: 21,
    reviewDays: 14,
    safetyStock: 0,
    onHand: 150,
    daysOfCover: Infinity,
    price: 30,
  });
  assert.equal(out.orderQty, 0);
  assert.equal(out.needsReorder, false);
});

test("buildDraftPo groups by supplier and totals cost", () => {
  const pos = buildDraftPo(
    [
      { sku: "A", qty: 24, unitCost: 10, supplierId: 1 },
      { sku: "B", qty: 48, unitCost: 5, supplierId: 1 },
      { sku: "C", qty: 12, unitCost: 20, supplierId: 2 },
      { sku: "D", qty: 6, supplierId: null },
    ],
    [
      { id: 1, name: "Acme" },
      { id: 2, name: "Beta Co" },
    ],
  );

  assert.equal(pos.length, 3);
  const acme = pos.find((p) => p.supplier === "Acme");
  assert.equal(acme.totalUnits, 72);
  assert.equal(acme.totalCost, 480); // 24*10 + 48*5
  assert.equal(acme.lines.length, 2);

  const unassigned = pos.find((p) => p.supplier === "(unassigned)");
  assert.equal(unassigned.totalUnits, 6);
  assert.equal(unassigned.supplierId, null);
});

test("buildDraftPo skips zero-qty and empty sku lines", () => {
  assert.deepEqual(
    buildDraftPo([{ sku: "A", qty: 0 }, { sku: "", qty: 10 }], []),
    [],
  );
});

test("rankByRevenueAtRisk sorts descending", () => {
  const ranked = rankByRevenueAtRisk([
    { sku: "B", shortfall: { revenueAtRisk: 100, unitsAtRisk: 10 } },
    { sku: "A", shortfall: { revenueAtRisk: 500, unitsAtRisk: 5 } },
    { sku: "C", shortfall: { revenueAtRisk: 100, unitsAtRisk: 20 } },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.sku),
    ["A", "C", "B"],
  );
});

test("formatDraftPoText includes draft disclaimer", () => {
  const text = formatDraftPoText(
    buildDraftPo(
      [{ sku: "X", qty: 216, unitCost: 12, supplierId: 1 }],
      [{ id: 1, name: "Acme" }],
    ),
  );
  assert.match(text, /Draft PO — Acme/);
  assert.match(text, /216 units/);
  assert.match(text, /does not place orders/);
});

test("formatDraftPoCsv has header and escaped values", () => {
  const csv = formatDraftPoCsv(
    buildDraftPo(
      [{ sku: 'X,"odd"', qty: 24, unitCost: 1.5, supplierId: 1 }],
      [{ id: 1, name: "Acme, Inc" }],
    ),
  );
  assert.match(csv, /^supplier,sku,qty,unit_cost,line_cost\n/);
  assert.match(csv, /"Acme, Inc"/);
  assert.match(csv, /"X,""odd"""/);
});

test("formatDraftPoText/Csv return null when empty", () => {
  assert.equal(formatDraftPoText([]), null);
  assert.equal(formatDraftPoCsv([]), null);
});
