/**
 * Reorder Brain recommendations (v0 math).
 *
 * Pure / deterministic — no I/O, Prisma, Shopify, or AI. Numbers here feed
 * the dashboard at-risk list and draft PO export; the agent may only explain
 * them.
 *
 * Demand / safety-stock inputs come from forecasting.js (WMA + calculateReorderPoint);
 * this module does not fork that math. Formulas and the worked example live in
 * the planning blueprint (07-reorder-brain), kept outside this repo.
 */

/**
 * Order-up-to level: cover lead time + review period, plus safety stock.
 * Safety stock is computed by callers via calculateReorderPoint (forecasting.js).
 *
 * @param {{
 *   dailyDemand: number,
 *   leadTimeDays: number,
 *   reviewDays: number,
 *   safetyStock: number,
 * }} args
 * @returns {number}
 */
export function orderUpToLevel({
  dailyDemand,
  leadTimeDays,
  reviewDays,
  safetyStock,
}) {
  if (!(dailyDemand > 0)) return 0;
  const lead = Number.isFinite(leadTimeDays) && leadTimeDays > 0 ? leadTimeDays : 0;
  const review = Number.isFinite(reviewDays) && reviewDays > 0 ? reviewDays : 0;
  const safety = Number.isFinite(safetyStock) && safetyStock > 0 ? safetyStock : 0;
  return round2(dailyDemand * (lead + review) + safety);
}

/**
 * Raw order quantity before MOQ / pack rounding. Never negative.
 *
 * @param {{ orderUpTo: number, onHand: number, onOrder?: number }} args
 * @returns {number}
 */
export function rawOrderQty({ orderUpTo, onHand, onOrder = 0 }) {
  const target = Number.isFinite(orderUpTo) ? orderUpTo : 0;
  const hand = Number.isFinite(onHand) ? onHand : 0;
  const inbound = Number.isFinite(onOrder) && onOrder > 0 ? onOrder : 0;
  return round2(Math.max(0, target - hand - inbound));
}

/**
 * Apply minimum order quantity, then round up to a pack-size multiple.
 * Qty 0 stays 0 (do not bump a zero need up to MOQ). Otherwise:
 * max(qty, moq), then ceil to the next pack multiple when packSize > 1.
 *
 * @param {{ qty: number, moq?: number | null, packSize?: number | null }} args
 * @returns {number}
 */
export function applyMoqAndPack({ qty, moq = null, packSize = null }) {
  if (!(qty > 0)) return 0;

  let q = qty;
  const minQty = Number.isFinite(moq) && moq > 0 ? moq : 0;
  if (minQty > 0) {
    q = Math.max(q, minQty);
  }

  const pack = Number.isFinite(packSize) && packSize > 1 ? packSize : 0;
  if (pack > 0) {
    q = Math.ceil(q / pack) * pack;
  }

  return q;
}

/**
 * Shortfall when days of cover is below lead time.
 * Zeros when cover ≥ lead time (or cover is non-finite / no demand).
 *
 * @param {{
 *   daysOfCover: number,
 *   leadTimeDays: number,
 *   dailyDemand: number,
 *   price?: number | null,
 * }} args
 * @returns {{ gapDays: number, unitsAtRisk: number, revenueAtRisk: number }}
 */
export function shortfall({
  daysOfCover,
  leadTimeDays,
  dailyDemand,
  price = 0,
}) {
  const zero = { gapDays: 0, unitsAtRisk: 0, revenueAtRisk: 0 };

  if (!(dailyDemand > 0)) return zero;
  if (!Number.isFinite(daysOfCover) || !Number.isFinite(leadTimeDays)) {
    return zero;
  }
  if (!(daysOfCover < leadTimeDays)) return zero;

  const gapDays = round2(leadTimeDays - daysOfCover);
  const unitsAtRisk = round2(gapDays * dailyDemand);
  const unitPrice = Number.isFinite(price) && price > 0 ? price : 0;
  const revenueAtRisk = round2(unitsAtRisk * unitPrice);

  return { gapDays, unitsAtRisk, revenueAtRisk };
}

/**
 * Full recommend-only reorder recommendation for one SKU.
 * Chains order-up-to → raw qty → MOQ/pack → shortfall. Pure.
 *
 * onOrder defaults to 0 in v0 (no inbound PO reads without new scopes).
 * Missing terms (no moq/pack) still produce a raw quantity.
 *
 * @param {{
 *   dailyDemand: number,
 *   leadTimeDays: number,
 *   reviewDays?: number,
 *   safetyStock: number,
 *   onHand: number,
 *   onOrder?: number,
 *   moq?: number | null,
 *   packSize?: number | null,
 *   daysOfCover: number,
 *   price?: number | null,
 * }} args
 * @returns {{
 *   orderUpTo: number,
 *   rawQty: number,
 *   orderQty: number,
 *   shortfall: { gapDays: number, unitsAtRisk: number, revenueAtRisk: number },
 *   needsReorder: boolean,
 * }}
 */
export function reorderRecommendation({
  dailyDemand,
  leadTimeDays,
  reviewDays = 14,
  safetyStock,
  onHand,
  onOrder = 0,
  moq = null,
  packSize = null,
  daysOfCover,
  price = 0,
}) {
  const orderUpTo = orderUpToLevel({
    dailyDemand,
    leadTimeDays,
    reviewDays,
    safetyStock,
  });
  const rawQty = rawOrderQty({ orderUpTo, onHand, onOrder });
  const orderQty = applyMoqAndPack({ qty: rawQty, moq, packSize });
  const short = shortfall({
    daysOfCover,
    leadTimeDays,
    dailyDemand,
    price,
  });

  return {
    orderUpTo,
    rawQty,
    orderQty,
    shortfall: short,
    needsReorder: orderQty > 0 || short.unitsAtRisk > 0,
  };
}

/**
 * Group recommended lines into draft POs by supplier.
 * Lines without a matching supplier go under supplier name "(unassigned)".
 *
 * @param {Array<{
 *   sku: string,
 *   title?: string,
 *   qty: number,
 *   unitCost?: number | null,
 *   supplierId?: number | null,
 * }>} lines
 * @param {Array<{ id: number, name: string }>} suppliers
 * @returns {Array<{
 *   supplierId: number | null,
 *   supplier: string,
 *   lines: Array<{ sku: string, title?: string, qty: number, unitCost: number | null, lineCost: number }>,
 *   totalUnits: number,
 *   totalCost: number,
 * }>}
 */
export function buildDraftPo(lines, suppliers = []) {
  const byId = new Map(
    (suppliers ?? []).map((s) => [s.id, s.name ?? `Supplier ${s.id}`]),
  );

  /** @type {Map<string, { supplierId: number | null, supplier: string, lines: any[], totalUnits: number, totalCost: number }>} */
  const groups = new Map();

  for (const line of lines ?? []) {
    const qty = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 0;
    if (qty <= 0 || !line.sku) continue;

    const supplierId =
      line.supplierId != null && Number.isFinite(line.supplierId)
        ? line.supplierId
        : null;
    const key = supplierId == null ? "unassigned" : String(supplierId);
    const supplierName =
      supplierId == null
        ? "(unassigned)"
        : byId.get(supplierId) ?? `Supplier ${supplierId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        supplierId,
        supplier: supplierName,
        lines: [],
        totalUnits: 0,
        totalCost: 0,
      });
    }

    const unitCost =
      Number.isFinite(line.unitCost) && line.unitCost >= 0 ? line.unitCost : null;
    const lineCost = unitCost != null ? round2(qty * unitCost) : 0;
    const group = groups.get(key);
    group.lines.push({
      sku: line.sku,
      title: line.title,
      qty,
      unitCost,
      lineCost,
    });
    group.totalUnits += qty;
    group.totalCost = round2(group.totalCost + lineCost);
  }

  return [...groups.values()].sort((a, b) =>
    a.supplier.localeCompare(b.supplier),
  );
}

/**
 * Rank SKUs by revenue at risk (desc), then units at risk, then SKU.
 *
 * @param {Array<{ sku: string, shortfall?: { revenueAtRisk?: number, unitsAtRisk?: number } }>} items
 * @returns {typeof items}
 */
export function rankByRevenueAtRisk(items) {
  return [...(items ?? [])].sort((a, b) => {
    const ar = a.shortfall?.revenueAtRisk ?? 0;
    const br = b.shortfall?.revenueAtRisk ?? 0;
    if (br !== ar) return br - ar;
    const au = a.shortfall?.unitsAtRisk ?? 0;
    const bu = b.shortfall?.unitsAtRisk ?? 0;
    if (bu !== au) return bu - au;
    return String(a.sku ?? "").localeCompare(String(b.sku ?? ""));
  });
}

/**
 * Plain-text draft PO a merchant can copy. Only includes numbers already
 * computed — never invents figures. Returns null when there are no lines.
 *
 * @param {ReturnType<typeof buildDraftPo>} draftPos
 * @returns {string | null}
 */
export function formatDraftPoText(draftPos) {
  if (!draftPos?.length) return null;

  const blocks = draftPos.map((po) => {
    const header = `Draft PO — ${po.supplier}`;
    const body = po.lines
      .map((l) => {
        const cost =
          l.unitCost != null
            ? ` @ $${round2(l.unitCost).toFixed(2)} = $${l.lineCost.toFixed(2)}`
            : "";
        const label = l.title && l.title !== l.sku ? `${l.sku} (${l.title})` : l.sku;
        return `  • ${label}: ${l.qty} units${cost}`;
      })
      .join("\n");
    const totals = `  Total: ${po.totalUnits} units` +
      (po.totalCost > 0 ? ` · $${po.totalCost.toFixed(2)}` : "");
    return [header, body, totals].join("\n");
  });

  return [
    ...blocks,
    "",
    "Draft only — Agent Forecast does not place orders or change your catalog.",
  ].join("\n\n");
}

/**
 * CSV export for draft POs (supplier, sku, qty, unitCost, lineCost).
 * Returns null when empty.
 *
 * @param {ReturnType<typeof buildDraftPo>} draftPos
 * @returns {string | null}
 */
export function formatDraftPoCsv(draftPos) {
  if (!draftPos?.length) return null;

  const rows = [["supplier", "sku", "qty", "unit_cost", "line_cost"]];
  for (const po of draftPos) {
    for (const l of po.lines) {
      rows.push([
        po.supplier,
        l.sku,
        String(l.qty),
        l.unitCost != null ? String(round2(l.unitCost)) : "",
        l.unitCost != null ? String(l.lineCost) : "",
      ]);
    }
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
