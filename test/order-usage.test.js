import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBySku,
  createQuantityForDelta,
  isVoidOrder,
  planOrderUsageUpdate,
  resolveSourceVersion,
} from "../app/lib/order-usage.js";

// In-memory stand-in for recordOrderUsage: one ProcessedOrder row + a
// DailyUsage map, driven only by the pure planner.
function newStore() {
  return { order: null, usage: {} };
}

function deliver(store, delivery) {
  const plan = planOrderUsageUpdate({
    previous: store.order,
    incoming: { lineItems: delivery.lineItems, sourceUpdatedAt: delivery.at ?? null },
  });
  if (plan.action === "apply") {
    for (const { sku, delta } of plan.deltas) {
      // Mirrors the DB upsert: increment if the row exists, else create
      // clamped at 0.
      store.usage[sku] =
        sku in store.usage
          ? store.usage[sku] + delta
          : createQuantityForDelta(delta);
    }
    store.order = {
      lineItems: plan.nextSnapshot,
      sourceUpdatedAt: plan.nextSourceUpdatedAt,
    };
  }
  return plan;
}

const NOW = new Date("2026-10-29T12:30:00Z");
const T = (n) => new Date(Date.UTC(2026, 9, 29, 12, 0, n));
const items = (qty, sku = "A") => [{ sku, quantity: qty }];

const CREATE = { name: "create", lineItems: items(5), at: T(1) };
const EDIT = { name: "edit", lineItems: items(3), at: T(2) };
const CANCEL = { name: "cancel", lineItems: [], at: T(3) };

function run(deliveries) {
  const store = newStore();
  for (const d of deliveries) deliver(store, d);
  return store;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

test("bug case: edit first, stale second -> usage stays at the edit", () => {
  const s = run([EDIT, { ...CREATE }]);
  assert.equal(s.usage.A, 3);
  assert.deepEqual(s.order.lineItems, { A: 3 });
});

test("bug case: cancelled first, stale second -> usage stays 0", () => {
  const s = run([CANCEL, CREATE]);
  assert.equal(s.usage.A ?? 0, 0);
  assert.deepEqual(s.order.lineItems, {});
});

test("stale delivery returns skip_stale and changes nothing", () => {
  const s = run([EDIT]);
  const before = structuredClone(s);
  const plan = deliver(s, CREATE);
  assert.equal(plan.action, "skip_stale");
  assert.deepEqual(plan.deltas, []);
  assert.deepEqual(s, before);
});

test("every delivery order of create/edit/cancel ends where in-order delivery does", () => {
  const expected = run([CREATE, EDIT, CANCEL]);
  assert.equal(expected.usage.A, 0);
  const perms = permutations([CREATE, EDIT, CANCEL]);
  assert.equal(perms.length, 6);
  for (const p of perms) {
    const s = run(p);
    const label = p.map((d) => d.name).join(" > ");
    assert.deepEqual(s.order.lineItems, expected.order.lineItems, label);
    assert.equal(s.order.sourceUpdatedAt.getTime(), T(3).getTime(), label);
    // A missing usage row reads as 0 (getUsageHistory fills gaps with 0).
    assert.equal(s.usage.A ?? 0, expected.usage.A ?? 0, label);
  }
});

test("every delivery order of create/edit ends at the edit (usage 3)", () => {
  for (const p of permutations([CREATE, EDIT])) {
    assert.equal(run(p).usage.A, 3, p.map((d) => d.name).join(" > "));
  }
});

test("plain duplicate deliveries are idempotent", () => {
  const s = run([CREATE, CREATE, CREATE]);
  assert.equal(s.usage.A, 5);
  const plan = deliver(s, CREATE);
  assert.equal(plan.action, "noop");
});

test("duplicate of an older state after a newer one is skipped, not re-applied", () => {
  const s = run([CREATE, EDIT, CREATE, EDIT, CREATE]);
  assert.equal(s.usage.A, 3);
});

test("legacy row with null sourceUpdatedAt accepts the next delivery and stamps it", () => {
  const plan = planOrderUsageUpdate({
    previous: { lineItems: { A: 5 }, sourceUpdatedAt: null },
    incoming: { lineItems: items(3), sourceUpdatedAt: T(2) },
  });
  assert.equal(plan.action, "apply");
  assert.deepEqual(plan.deltas, [{ sku: "A", delta: -2 }]);
  assert.equal(plan.nextSourceUpdatedAt.getTime(), T(2).getTime());
});

test("legacy row + identical snapshot still stamps the version (apply, no deltas)", () => {
  const plan = planOrderUsageUpdate({
    previous: { lineItems: { A: 5 }, sourceUpdatedAt: null },
    incoming: { lineItems: items(5), sourceUpdatedAt: T(2) },
  });
  assert.equal(plan.action, "apply");
  assert.deepEqual(plan.deltas, []);
  assert.equal(plan.nextSourceUpdatedAt.getTime(), T(2).getTime());
});

test("a stamped version blocks an older edit that lands after a no-delta update", () => {
  // v1 qty5, v3 tag-only (qty5), then the older v2 qty3 edit arrives late.
  const s = run([
    { lineItems: items(5), at: T(1) },
    { lineItems: items(5), at: T(3) },
    { lineItems: items(3), at: T(2) },
  ]);
  assert.equal(s.usage.A, 5);
});

test("incoming without a version applies and never regresses the stored version", () => {
  const plan = planOrderUsageUpdate({
    previous: { lineItems: { A: 5 }, sourceUpdatedAt: T(5) },
    incoming: { lineItems: items(4), sourceUpdatedAt: null },
  });
  assert.equal(plan.action, "apply");
  assert.deepEqual(plan.deltas, [{ sku: "A", delta: -1 }]);
  assert.equal(plan.nextSourceUpdatedAt.getTime(), T(5).getTime());
});

test("no previous and no version: first delivery applies, does not throw", () => {
  const plan = planOrderUsageUpdate({
    previous: null,
    incoming: { lineItems: items(2), sourceUpdatedAt: null },
  });
  assert.equal(plan.action, "apply");
  assert.equal(plan.nextSourceUpdatedAt, null);
  assert.deepEqual(plan.deltas, [{ sku: "A", delta: 2 }]);
});

test("junk versions are treated as missing, not thrown on", () => {
  const plan = planOrderUsageUpdate({
    previous: { lineItems: { A: 1 }, sourceUpdatedAt: "not-a-date" },
    incoming: { lineItems: items(2), sourceUpdatedAt: "also-bad" },
  });
  assert.equal(plan.action, "apply");
  assert.deepEqual(plan.deltas, [{ sku: "A", delta: 1 }]);
});

test("same-timestamp tie: not stale, goes through the delta path (last arrival wins)", () => {
  const a = { lineItems: items(5), at: T(1) };
  const b = { lineItems: items(3), at: T(1) };
  assert.equal(run([a, b]).usage.A, 3);
  assert.equal(run([b, a]).usage.A, 5);
  // Same snapshot at same version stays a no-op.
  const s = run([a]);
  assert.equal(deliver(s, a).action, "noop");
});

test("SKU removed in an edit is subtracted back out", () => {
  const s = run([
    { lineItems: [...items(2, "A"), ...items(4, "B")], at: T(1) },
    { lineItems: items(2, "A"), at: T(2) },
  ]);
  assert.equal(s.usage.A, 2);
  assert.equal(s.usage.B, 0);
  assert.deepEqual(s.order.lineItems, { A: 2 });
});

test("SKU-less items are ignored and duplicate SKU lines are summed", () => {
  assert.deepEqual(
    aggregateBySku([
      { sku: "A", quantity: 2 },
      { sku: "", quantity: 9 },
      { sku: null, quantity: 9 },
      { quantity: 9 },
      { sku: "A", quantity: 3 },
    ]),
    { A: 5 },
  );
  const s = run([{ lineItems: [{ sku: null, quantity: 4 }], at: T(1) }]);
  assert.deepEqual(s.usage, {});
});

test("negative delta never creates a negative DailyUsage row", () => {
  assert.equal(createQuantityForDelta(-3), 0);
  assert.equal(createQuantityForDelta(4), 4);
  // Order recorded before usage rows existed (e.g. usage row was purged):
  // a reduction on a fresh usage map must clamp at 0.
  const store = {
    order: { lineItems: { A: 5 }, sourceUpdatedAt: T(1) },
    usage: {},
  };
  deliver(store, { lineItems: items(2), at: T(2) });
  assert.equal(store.usage.A, 0);
});

test("resolveSourceVersion prefers triggered-at (ms) over updated_at, falls back, never throws", () => {
  const v = resolveSourceVersion("2026-10-29T12:00:00.123Z", "2026-10-29T12:00:00Z", NOW);
  assert.equal(v.toISOString(), "2026-10-29T12:00:00.123Z");
  assert.equal(
    resolveSourceVersion(undefined, "2026-10-29T12:00:05Z", NOW).toISOString(),
    "2026-10-29T12:00:05.000Z",
  );
  assert.equal(
    resolveSourceVersion("garbage", "2026-10-29T12:00:05Z", NOW).toISOString(),
    "2026-10-29T12:00:05.000Z",
  );
  assert.equal(resolveSourceVersion(undefined, undefined), null);
  assert.equal(resolveSourceVersion("", null), null);
});

test("isVoidOrder: cancelled, refunded, voided count; paid does not", () => {
  assert.equal(isVoidOrder({ cancelled_at: "2026-10-29T00:00:00Z" }), true);
  assert.equal(isVoidOrder({ financial_status: "refunded" }), true);
  assert.equal(isVoidOrder({ financial_status: "voided" }), true);
  assert.equal(isVoidOrder({ financial_status: "paid" }), false);
  assert.equal(isVoidOrder({ financial_status: "partially_refunded" }), false);
  assert.equal(isVoidOrder(null), false);
});

// ---------------------------------------------------------------------------
// Adversarial review additions
// ---------------------------------------------------------------------------

test("backfill-stamped row (second precision) rejects older webhook, accepts newer one", () => {
  const store = {
    order: { lineItems: { A: 3 }, sourceUpdatedAt: T(10) }, // backfill: GraphQL updatedAt
    usage: { A: 3 },
  };
  // Stale create (state qty 5) delivered after backfill saw the edited state.
  assert.equal(deliver(store, { lineItems: items(5), at: T(1) }).action, "skip_stale");
  assert.equal(store.usage.A, 3);
  // Webhook for the same state, triggered-at ms after the backfill's updatedAt: version bumps, no usage change.
  const same = deliver(store, { lineItems: items(3), at: new Date(T(10).getTime() + 400) });
  assert.equal(same.action, "apply");
  assert.deepEqual(same.deltas, []);
  assert.equal(store.usage.A, 3);
  // A genuinely newer edit applies.
  deliver(store, { lineItems: items(1), at: T(11) });
  assert.equal(store.usage.A, 1);
});

test("a versionless delivery between versioned ones does not let a stale versioned one through", () => {
  const s = run([
    { lineItems: items(3), at: T(5) },
    { lineItems: items(4), at: null }, // header and updated_at both unusable
    { lineItems: items(9), at: T(2) }, // stale
  ]);
  assert.equal(s.order.sourceUpdatedAt.getTime(), T(5).getTime());
  assert.equal(s.usage.A, 4); // versionless delivery is trusted as-is
});

test("placeholder-shaped row (empty snapshot, null version) behaves like a brand-new order", () => {
  const plan = planOrderUsageUpdate({
    previous: { lineItems: {}, sourceUpdatedAt: null },
    incoming: { lineItems: items(2), sourceUpdatedAt: T(1) },
  });
  assert.equal(plan.action, "apply");
  assert.deepEqual(plan.deltas, [{ sku: "A", delta: 2 }]);
  // Void first-ever delivery with a version still stamps it (apply, no deltas),
  // so a late-arriving create cannot resurrect usage.
  const store = { order: { lineItems: {}, sourceUpdatedAt: null }, usage: {} };
  assert.equal(deliver(store, { lineItems: [], at: T(3) }).action, "apply");
  assert.equal(deliver(store, { lineItems: items(5), at: T(1) }).action, "skip_stale");
  assert.equal(store.usage.A ?? 0, 0);
});

test("characterization: equal-version different snapshots flip-flop on redelivery", () => {
  const a = { lineItems: items(5), at: T(1) };
  const b = { lineItems: items(3), at: T(1) };
  assert.equal(run([a, b, a]).usage.A, 5); // retry of `a` after `b` wins; unavoidable with a tie
});

// Known bugs found by review. `todo` keeps the suite green until fixed.
test("SKU names colliding with Object.prototype keys aggregate correctly", () => {
  assert.deepEqual(aggregateBySku([{ sku: "constructor", quantity: 2 }]), { constructor: 2 });
  assert.deepEqual(aggregateBySku([{ sku: "__proto__", quantity: 2 }]), { ["__proto__"]: 2 });
  const plan = planOrderUsageUpdate({
    previous: { lineItems: { toString: 1 }, sourceUpdatedAt: null },
    incoming: { lineItems: [{ sku: "toString", quantity: 3 }], sourceUpdatedAt: null },
  });
  assert.deepEqual(plan.deltas, [{ sku: "toString", delta: 2 }]);
});

test("numeric-looking junk header does not parse as a real timestamp", () => {
  const v = resolveSourceVersion("1", "2026-10-29T12:00:05Z", NOW);
  assert.equal(v.toISOString(), "2026-10-29T12:00:05.000Z");
});

test("far-future version is ignored (falls back), so it cannot poison an order", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const v = resolveSourceVersion("2200-01-01T00:00:00Z", "2026-10-29T11:59:59Z", now);
  assert.equal(v.toISOString(), "2026-10-29T11:59:59.000Z");
  assert.equal(resolveSourceVersion("2200-01-01T00:00:00Z", "2200-01-01T00:00:00Z", now), null);
});
