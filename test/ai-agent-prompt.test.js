import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../app/lib/ai-agent.js";

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
