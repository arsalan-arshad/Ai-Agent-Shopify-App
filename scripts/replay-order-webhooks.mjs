#!/usr/bin/env node
/**
 * Replays HMAC-signed orders/updated webhooks at a locally running server
 * to verify out-of-order / duplicate / concurrent delivery handling.
 *
 * NOT part of `npm test`. Usage (throwaway DB + dummy secrets only):
 *   DATABASE_URL=postgresql://macbook@localhost:5432/agent_forecast_replay_test \
 *   SHOPIFY_API_SECRET=dummysecret BASE_URL=http://localhost:39217 \
 *   node scripts/replay-order-webhooks.mjs [seed]
 * The server must run with the same DATABASE_URL and SHOPIFY_API_SECRET.
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const DB = process.env.DATABASE_URL ?? "";
const SECRET = process.env.SHOPIFY_API_SECRET;
const BASE = process.env.BASE_URL ?? "http://localhost:39217";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\/agent_forecast_replay_test(\?|$)/.test(DB)) {
  console.error("Refusing to run: DATABASE_URL must be localhost/agent_forecast_replay_test");
  process.exit(2);
}
if (!SECRET) { console.error("SHOPIFY_API_SECRET required"); process.exit(2); }

const prisma = new PrismaClient();
const SEED = Number(process.argv[2] ?? Date.now() % 2147483647);
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const CREATED_AT = "2026-10-20T10:00:00Z";
const DAY = new Date("2026-10-20T00:00:00.000Z");
const SKU = "SKU-A";
const iso = (ms) => new Date(ms).toISOString();
let deliveryCounter = 0;

/** event: {kind, qty, cancelled, ver(ms)} */
const ev = {
  create: (ver = T0) => ({ kind: "create", qty: 5, cancelled: false, ver }),
  edit: (ver = T0 + 1000) => ({ kind: "edit", qty: 3, cancelled: false, ver }),
  cancel: (ver = T0 + 2000) => ({ kind: "cancel", qty: 3, cancelled: true, ver }),
  // Edited down: quantity stays at the original 5, current_quantity is 2.
  editCurrent: (ver = T0 + 1500) => ({ kind: "editCurrent", qty: 5, cq: 2, cancelled: false, ver }),
  // Partial refund: quantity 5, current_quantity 4.
  partialRefund: (ver = T0 + 1800) => ({ kind: "partialRefund", qty: 5, cq: 4, cancelled: false, ver }),
};
const effQty = (e) => (e.cancelled ? 0 : (e.cq ?? e.qty));

async function send(shop, orderId, e, { withHeader = true, secret = SECRET } = {}) {
  const payload = {
    id: Number(orderId),
    created_at: CREATED_AT,
    updated_at: iso(e.ver).replace(/\.\d+Z$/, "Z"),
    cancelled_at: e.cancelled ? iso(e.ver) : null,
    financial_status: "paid",
    line_items: [
      e.cq === undefined
        ? { sku: SKU, quantity: e.qty }
        : { sku: SKU, quantity: e.qty, current_quantity: e.cq },
    ],
  };
  const body = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
  const headers = {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": hmac,
    "x-shopify-topic": "orders/updated",
    "x-shopify-shop-domain": shop,
    "x-shopify-api-version": "2026-10",
    "x-shopify-webhook-id": `replay-${process.pid}-${++deliveryCounter}-${crypto.randomUUID()}`,
  };
  if (withHeader) headers["x-shopify-triggered-at"] = iso(e.ver);
  const res = await fetch(`${BASE}/webhooks/orders-updated`, { method: "POST", headers, body });
  return res.status;
}

async function state(shop, orderId) {
  const du = await prisma.dailyUsage.findMany({ where: { shop }, orderBy: { sku: "asc" } });
  const po = await prisma.processedOrder.findUnique({
    where: { shop_order: { shop, orderId } },
  });
  return {
    usage: Object.fromEntries(du.map((r) => [`${r.sku}@${r.date.toISOString().slice(0, 10)}`, r.quantity])),
    po,
  };
}

/** Oracle: state after in-order delivery = highest-version event wins. */
function expectedFor(events) {
  const last = [...events].sort((a, b) => a.ver - b.ver).at(-1);
  return {
    qty: effQty(last),
    snapshot: effQty(last) === 0 ? {} : { [SKU]: effQty(last) },
    ver: last.ver,
  };
}

function check(st, exp, { checkVer = true } = {}) {
  const errs = [];
  const q = st.usage[`${SKU}@2026-10-20`] ?? 0;
  if (q !== exp.qty) errs.push(`DailyUsage qty ${q} != ${exp.qty}`);
  const extra = Object.keys(st.usage).filter((k) => k !== `${SKU}@2026-10-20`);
  if (extra.length) errs.push(`unexpected usage rows ${extra}`);
  if (!st.po) errs.push("ProcessedOrder missing");
  else {
    if (JSON.stringify(st.po.lineItems) !== JSON.stringify(exp.snapshot))
      errs.push(`snapshot ${JSON.stringify(st.po.lineItems)} != ${JSON.stringify(exp.snapshot)}`);
    if (checkVer && st.po.sourceUpdatedAt?.getTime() !== exp.ver)
      errs.push(`sourceUpdatedAt ${st.po.sourceUpdatedAt?.toISOString()} != ${iso(exp.ver)}`);
  }
  return errs;
}

const results = [];
const record = (name, errs) => {
  results.push({ name, ok: errs.length === 0, errs });
  console.log(`${errs.length ? "FAIL" : "PASS"}  ${name}${errs.length ? "\n      " + errs.join("\n      ") : ""}`);
};
let shopN = 0;
const newShop = (tag) => `replay-${tag}-${process.pid}-${++shopN}.myshopify.com`;
let orderSeq = 7000000000;
const newOrder = () => String(++orderSeq);

async function sequential(shop, orderId, events, opts) {
  const codes = [];
  for (const e of events) codes.push(await send(shop, orderId, e, opts));
  return codes;
}
const okCodes = (codes) => codes.filter((c) => c !== 200).map((c) => `HTTP ${c}`);

async function scenario(name, fn) {
  try { record(name, await fn()); }
  catch (err) { record(name, [`script error: ${err.stack ?? err}`]); }
}

console.log(`seed=${SEED} base=${BASE}`);

// 0. HMAC sanity
await scenario("hmac: bad signature rejected (401)", async () => {
  const shop = newShop("hmac");
  const code = await send(shop, newOrder(), ev.create(), { secret: "wrong" });
  return code === 401 ? [] : [`got HTTP ${code}`];
});

await scenario("1. in-order create+edit", async () => {
  const shop = newShop("s1"), id = newOrder();
  const codes = await sequential(shop, id, [ev.create(), ev.edit()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create(), ev.edit()]))];
});

await scenario("2. edit-then-stale-create", async () => {
  const shop = newShop("s2"), id = newOrder();
  const codes = await sequential(shop, id, [ev.edit(), ev.create()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create(), ev.edit()]))];
});

await scenario("3. cancel-then-stale (edit, create)", async () => {
  const shop = newShop("s3"), id = newOrder();
  const codes = await sequential(shop, id, [ev.cancel(), ev.edit(), ev.create()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create(), ev.edit(), ev.cancel()]))];
});

await scenario("4a. duplicate create x3", async () => {
  const shop = newShop("s4a"), id = newOrder();
  const codes = await sequential(shop, id, [ev.create(), ev.create(), ev.create()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create()]))];
});
await scenario("4b. duplicate edit x3 after create", async () => {
  const shop = newShop("s4b"), id = newOrder();
  const codes = await sequential(shop, id, [ev.create(), ev.edit(), ev.edit(), ev.edit()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.edit()]))];
});
await scenario("4c. duplicate cancel x3 after create", async () => {
  const shop = newShop("s4c"), id = newOrder();
  const codes = await sequential(shop, id, [ev.create(), ev.cancel(), ev.cancel(), ev.cancel()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.cancel()]))];
});

await scenario("5a. concurrent create||edit x30 (random order)", async () => {
  const errs = [];
  for (let i = 0; i < 30; i++) {
    const shop = newShop("s5a"), id = newOrder();
    const evs = shuffle([ev.create(), ev.edit()]);
    const codes = await Promise.all(evs.map((e) => send(shop, id, e)));
    const e = [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
    if (e.length) errs.push(`iter ${i} order=[${evs.map((x) => x.kind)}]: ${e.join("; ")}`);
  }
  return errs;
});
await scenario("5b. concurrent create||edit||cancel x30 (random order)", async () => {
  const errs = [];
  for (let i = 0; i < 30; i++) {
    const shop = newShop("s5b"), id = newOrder();
    const evs = shuffle([ev.create(), ev.edit(), ev.cancel()]);
    const codes = await Promise.all(evs.map((e) => send(shop, id, e)));
    const e = [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
    if (e.length) errs.push(`iter ${i} order=[${evs.map((x) => x.kind)}]: ${e.join("; ")}`);
  }
  return errs;
});
await scenario("5c. concurrent identical duplicates x3, x20 (same order)", async () => {
  const errs = [];
  for (let i = 0; i < 20; i++) {
    const shop = newShop("s5c"), id = newOrder();
    const codes = await Promise.all([1, 2, 3].map(() => send(shop, id, ev.create())));
    const e = [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create()]))];
    if (e.length) errs.push(`iter ${i}: ${e.join("; ")}`);
  }
  return errs;
});
await scenario("5d. many orders concurrently interleaved (10 orders x 3 events, one shop)", async () => {
  const shop = newShop("s5d");
  const ids = Array.from({ length: 10 }, newOrder);
  const jobs = shuffle(ids.flatMap((id) => [ev.create(), ev.edit(), ev.cancel()].map((e) => ({ id, e }))));
  const codes = await Promise.all(jobs.map(({ id, e }) => send(shop, id, e)));
  const errs = okCodes(codes);
  const du = await prisma.dailyUsage.findMany({ where: { shop } });
  const total = du.reduce((s, r) => s + r.quantity, 0);
  if (total !== 0) errs.push(`total DailyUsage ${total} != 0`);
  const n = await prisma.processedOrder.count({ where: { shop } });
  if (n !== 10) errs.push(`ProcessedOrder rows ${n} != 10`);
  return errs;
});

await scenario("6. 20 random permutations of create/edit/cancel (sequential)", async () => {
  const errs = [];
  for (let i = 0; i < 20; i++) {
    const shop = newShop("s6"), id = newOrder();
    const evs = shuffle([ev.create(), ev.edit(), ev.cancel()]);
    const codes = await sequential(shop, id, evs);
    const e = [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
    if (e.length) errs.push(`perm ${i} [${evs.map((x) => x.kind)}]: ${e.join("; ")}`);
  }
  return errs;
});
await scenario("6b. 20 random permutations of create/edit only (sequential, expect qty 3)", async () => {
  const errs = [];
  for (let i = 0; i < 20; i++) {
    const shop = newShop("s6b"), id = newOrder();
    const evs = shuffle([ev.create(), ev.edit(), ev.create(T0 + 500)]);
    const codes = await sequential(shop, id, evs);
    const e = [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
    if (e.length) errs.push(`perm ${i} [${evs.map((x) => x.kind + x.ver)}]: ${e.join("; ")}`);
  }
  return errs;
});

await scenario("7a. legacy NULL sourceUpdatedAt row, then newer edit applies", async () => {
  const shop = newShop("s7a"), id = newOrder();
  await prisma.processedOrder.create({ data: { shop, orderId: id, date: DAY, lineItems: { [SKU]: 5 } } });
  await prisma.dailyUsage.create({ data: { shop, sku: SKU, date: DAY, quantity: 5 } });
  const codes = await sequential(shop, id, [ev.edit()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.edit()]))];
});
await scenario("7b. legacy NULL row, then (older) create redelivery then edit", async () => {
  const shop = newShop("s7b"), id = newOrder();
  await prisma.processedOrder.create({ data: { shop, orderId: id, date: DAY, lineItems: { [SKU]: 5 } } });
  await prisma.dailyUsage.create({ data: { shop, sku: SKU, date: DAY, quantity: 5 } });
  const codes = await sequential(shop, id, [ev.create(), ev.edit(), ev.create()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create(), ev.edit()]))];
});
await scenario("7c. legacy NULL row, cancel applies", async () => {
  const shop = newShop("s7c"), id = newOrder();
  await prisma.processedOrder.create({ data: { shop, orderId: id, date: DAY, lineItems: { [SKU]: 5 } } });
  await prisma.dailyUsage.create({ data: { shop, sku: SKU, date: DAY, quantity: 5 } });
  const codes = await sequential(shop, id, [ev.cancel(), ev.edit()]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.edit(), ev.cancel()]))];
});

await scenario("8. no X-Shopify-Triggered-At header: falls back to payload.updated_at (edit, stale create)", async () => {
  const shop = newShop("s8"), id = newOrder();
  const codes = await sequential(shop, id, [ev.edit(), ev.create()], { withHeader: false });
  // updated_at is second precision; versions here are whole seconds apart.
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([ev.create(), ev.edit()]))];
});

await scenario("9. same-ms-version different second? sub-second edits ordered by header", async () => {
  const shop = newShop("s9"), id = newOrder();
  const a = ev.create(T0), b = ev.edit(T0 + 300); // same payload second
  const codes = await sequential(shop, id, [b, a]);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor([a, b]))];
});

// 10. current_quantity (edited / partially refunded orders)
await scenario("10a. edit down via current_quantity (5 -> 2)", async () => {
  const shop = newShop("s10a"), id = newOrder();
  const evs = [ev.create(), ev.editCurrent()];
  const codes = await sequential(shop, id, evs);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
});
await scenario("10b. partial refund (5, current 4), then duplicated x3", async () => {
  const shop = newShop("s10b"), id = newOrder();
  const evs = [ev.create(), ev.partialRefund(), ev.partialRefund(), ev.partialRefund()];
  const codes = await sequential(shop, id, evs);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
});
await scenario("10c. edit-with-current_quantity arrives before create", async () => {
  const shop = newShop("s10c"), id = newOrder();
  const evs = [ev.editCurrent(), ev.create()];
  const codes = await sequential(shop, id, evs);
  return [...okCodes(codes), ...check(await state(shop, id), expectedFor(evs))];
});
await scenario("10d. 20 random orders mixing create/edit/partial refund/cancel", async () => {
  const errs = [];
  for (let i = 0; i < 20; i++) {
    const shop = newShop(`s10d${i}`), id = newOrder();
    const pool = [ev.create(), ev.editCurrent(), ev.partialRefund(), ev.cancel()];
    // Drop cancel in half the runs so non-void final states are covered.
    const evs = shuffle(rng() < 0.5 ? pool : pool.slice(0, 3));
    const codes = await sequential(shop, id, evs);
    errs.push(...okCodes(codes), ...check(await state(shop, id), expectedFor(evs)).map((m) => `run ${i}: ${m}`));
  }
  return errs;
});

const failed = results.filter((r) => !r.ok);
console.log(`\nseed=${SEED}`);
console.log("\n| # | scenario | result |\n|---|---|---|");
results.forEach((r, i) => console.log(`| ${i} | ${r.name} | ${r.ok ? "PASS" : "FAIL"} |`));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await prisma.$disconnect();
process.exit(failed.length ? 1 : 0);
