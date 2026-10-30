/**
 * Pure ordering/reconcile logic for orders/create + orders/updated webhooks.
 * No I/O, no Date.now(): same inputs always give the same plan.
 *
 * Shopify does not guarantee webhook ordering (within a topic or across
 * topics), so the "last delivery wins" approach lets a stale delivery
 * overwrite newer state. Each delivery therefore carries a version, and a
 * delivery older than what we already recorded is skipped.
 *
 * VERSION SOURCE: X-Shopify-Triggered-At (millisecond precision) when
 * present, else payload.updated_at (second precision). The header is
 * preferred because two edits inside the same second are plausible and only
 * the header can tell them apart. Backfill stamps the order's GraphQL
 * updatedAt (second precision); a real triggered-at is always >= the
 * updated_at of the state it describes, so a backfilled row never rejects a
 * genuinely newer delivery.
 *
 * TIES: equal versions are NOT treated as stale. They go through the normal
 * delta path, which keeps duplicate deliveries idempotent (same snapshot =>
 * no deltas). Two different edits stamped with the identical version resolve
 * to whichever arrives last; with ms precision this is rare and unavoidable.
 *
 * MISSING VERSIONS: a legacy row (null sourceUpdatedAt) or a delivery with
 * no usable version is always applicable. A versionless delivery never
 * regresses a stored version.
 */

const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T/;

const VOID_FINANCIAL_STATUSES = new Set(["refunded", "voided"]);

/** True when the order should count for no usage at all. */
export function isVoidOrder(payload) {
  return (
    !!payload?.cancelled_at ||
    VOID_FINANCIAL_STATUSES.has(payload?.financial_status)
  );
}

/**
 * Picks the delivery version: triggered-at header, else payload updated_at.
 * Returns a Date or null (never throws on junk input).
 */
export function resolveSourceVersion(triggeredAt, updatedAt, now = new Date()) {
  const ceiling = toValidDate(now)?.getTime() + MAX_FUTURE_SKEW_MS;
  const usable = (value) => {
    const d = toIsoDate(value);
    // A version far in the future would make every later real delivery look
    // stale, so treat it as missing and fall through to the next source.
    return d && !(d.getTime() > ceiling) ? d : null;
  };
  return usable(triggeredAt) ?? usable(updatedAt);
}

/**
 * Effective demand quantity of one line item (webhook snake_case or GraphQL
 * camelCase): current_quantity when it is a finite, non-negative number, else
 * quantity under the same guard, else 0. Never negative, never NaN.
 *
 * Shopify's `quantity` includes refunded and removed units. GraphQL
 * `currentQuantity` excludes both; the REST/webhook docs only say
 * current_quantity is quantity minus the removed quantity, so whether the
 * webhook value also subtracts refunded units is NOT confirmed by the docs
 * (check the TEMP log in webhooks.orders-updated.jsx on a dev store).
 * Without this, an order edited down from 3 to 2 keeps counting 3. PRODUCT DECISION (default, to be confirmed):
 * refunded and removed units are treated as not-demand, consistent with the
 * existing full-refund/cancel behavior (isVoidOrder). The fallback to
 * `quantity` keeps payloads that lack the field working. Usage recorded
 * before this change keeps the original quantities.
 */
export function effectiveQuantity(item) {
  const current = item?.current_quantity ?? item?.currentQuantity;
  if (isCount(current)) return current;
  return isCount(item?.quantity) ? item.quantity : 0;
}

function isCount(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * Aggregates line items into { sku: qty }. Drops SKU-less items (bundles,
 * tips, ...). An order can repeat a SKU across lines, so quantities sum.
 */
export function aggregateBySku(lineItems) {
  // A Map (then fromEntries) so SKUs like "constructor" or "__proto__" are
  // ordinary keys and never collide with Object.prototype.
  const map = new Map();
  for (const item of lineItems ?? []) {
    if (!item?.sku) continue;
    map.set(item.sku, (map.get(item.sku) ?? 0) + (item.quantity ?? 0));
  }
  // A SKU whose units were all removed carries no demand; keep the snapshot
  // free of zero entries (the delta against the old snapshot is unchanged).
  return Object.fromEntries([...map].filter(([, qty]) => qty !== 0));
}

/**
 * @param {object} args
 * @param {{ lineItems: Record<string, number>, sourceUpdatedAt: Date|null } | null} args.previous
 *   stored ProcessedOrder state, or null if the order was never seen
 * @param {{ lineItems: Array<{sku?: string, quantity?: number}>, sourceUpdatedAt: Date|null }} args.incoming
 *   already void-adjusted (void orders pass lineItems: [])
 * @returns {{
 *   action: "skip_stale" | "noop" | "apply",
 *   deltas: Array<{ sku: string, delta: number }>,
 *   nextSnapshot: Record<string, number>,
 *   nextSourceUpdatedAt: Date|null,
 * }}
 */
export function planOrderUsageUpdate({ previous, incoming }) {
  const previousMap = previous?.lineItems ?? {};
  const previousVersion = toValidDate(previous?.sourceUpdatedAt);
  const incomingVersion = toValidDate(incoming?.sourceUpdatedAt);

  if (previousVersion && incomingVersion && incomingVersion < previousVersion) {
    return {
      action: "skip_stale",
      deltas: [],
      nextSnapshot: previousMap,
      nextSourceUpdatedAt: previousVersion,
    };
  }

  const nextSnapshot = aggregateBySku(incoming?.lineItems);

  const deltas = [];
  const skus = new Set([...Object.keys(nextSnapshot), ...Object.keys(previousMap)]);
  for (const sku of [...skus].sort()) {
    const delta = ownQty(nextSnapshot, sku) - ownQty(previousMap, sku);
    if (delta !== 0) deltas.push({ sku, delta });
  }

  // Never move the stored version backwards (versionless delivery) and
  // advance it even when nothing else changed: otherwise a delayed older
  // edit could still slip past a version we should have recorded.
  const nextSourceUpdatedAt = incomingVersion ?? previousVersion;
  const versionAdvances =
    nextSourceUpdatedAt?.getTime() !== previousVersion?.getTime();

  if (previous && deltas.length === 0 && !versionAdvances) {
    return { action: "noop", deltas, nextSnapshot, nextSourceUpdatedAt };
  }
  return { action: "apply", deltas, nextSnapshot, nextSourceUpdatedAt };
}

/**
 * Quantity for a DailyUsage row created by a delta. A net-negative delta with
 * no existing row (shouldn't normally happen) clamps to 0 instead of
 * creating a negative count.
 */
export function createQuantityForDelta(delta) {
  return Math.max(delta, 0);
}

function ownQty(map, sku) {
  return Object.hasOwn(map, sku) ? map[sku] : 0;
}

// Strings must look like an ISO timestamp: new Date("1") is year 2000.
function toIsoDate(value) {
  if (typeof value === "string" && !ISO_LIKE.test(value)) return null;
  return toValidDate(value);
}

function toValidDate(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
