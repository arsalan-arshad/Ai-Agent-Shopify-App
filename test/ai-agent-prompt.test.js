import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../app/lib/ai-prompt.js";

test("system prompt embeds the snapshot and forbids inventing preorder figures", () => {
  const snapshot = [
    {
      sku: "Y",
      title: "Widget Y",
      currentStock: 120,
      avgDailyUsage: 8,
      daysOfCover: 15,
      preorder: {
        restockDate: "2026-11-25",
        restockDay: 29,
        recommendation: {
          state: "candidate",
          gapDays: 14,
          unitsAtRisk: 112,
          switchOnDay: 12,
        },
      },
    },
  ];

  const prompt = buildSystemPrompt(snapshot);

  assert.match(prompt, /Current forecast snapshot \(JSON\):/);
  assert.ok(
    prompt.includes(JSON.stringify(snapshot, null, 2)),
    "snapshot JSON must be embedded in the system prompt",
  );
  assert.match(
    prompt,
    /never invent a\s+gap, restock date, or units-at-risk figure that isn't in the snapshot/i,
  );
});

test("system prompt embeds reorder fields and forbids inventing reorder figures", () => {
  const snapshot = [
    {
      sku: "X",
      title: "Widget X",
      currentStock: 150,
      avgDailyUsage: 8,
      daysOfCover: 18.75,
      reorder: {
        supplierName: "Acme",
        moq: 200,
        packSize: 24,
        unitCost: 12,
        recommendation: {
          orderUpTo: 302.68,
          rawQty: 152.68,
          orderQty: 216,
          shortfall: {
            gapDays: 2.25,
            unitsAtRisk: 18,
            revenueAtRisk: 540,
          },
          needsReorder: true,
        },
        shortfall: {
          gapDays: 2.25,
          unitsAtRisk: 18,
          revenueAtRisk: 540,
        },
      },
    },
  ];

  const prompt = buildSystemPrompt(snapshot);

  assert.ok(
    prompt.includes(JSON.stringify(snapshot, null, 2)),
    "snapshot JSON with reorder must be embedded in the system prompt",
  );
  assert.match(prompt, /"orderQty": 216/);
  assert.match(prompt, /"revenueAtRisk": 540/);
  assert.match(
    prompt,
    /never invent an order quantity, MOQ, pack size, shortfall, or revenue\s+at risk figure that isn't in the snapshot/i,
  );
  assert.match(prompt, /recommend-only \(copy\/CSV drafts only\)/i);
});
