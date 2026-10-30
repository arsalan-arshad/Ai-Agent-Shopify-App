import { authenticate } from "../lib/shopify.server.js";
import { effectiveQuantity, isVoidOrder, resolveSourceVersion } from "../lib/order-usage.js";
import { recordOrderUsage } from "../lib/usage-history.server.js";

/**
 * Fires on orders/create and orders/updated (see shopify.app.toml).
 *
 * TOKEN LIFECYCLE: this is exactly the "background job" context where
 * expiring-token bugs surface first — there's no live user session to
 * trigger a re-auth prompt. authenticate.webhook refreshes the stored
 * offline token transparently as long as shopify.server.js has
 * `future.expiringOfflineAccessTokens: true` and the Session table has a
 * valid refresh token on file (see prisma/schema.prisma).
 *
 * IDEMPOTENCY + ORDERING: orders/updated fires on nearly any edit to an
 * order, Shopify can redeliver any webhook, and delivery order is NOT
 * guaranteed (within or across topics). recordOrderUsage
 * (usage-history.server.js) keeps the last line-item snapshot and delivery
 * version per order: duplicates apply no delta, and a delivery older than
 * the stored version (X-Shopify-Triggered-At, else payload.updated_at) is
 * skipped instead of overwriting newer state.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload, triggeredAt } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} received for ${shop}, order ${payload?.id}`);

  if (!payload?.id || !payload?.created_at) {
    console.warn(`Webhook ${topic} for ${shop} missing id/created_at, skipping`);
    return new Response();
  }

  // Cancelled/refunded/voided orders have no inventory impact worth
  // tracking as "usage" — treat as zero line items so a prior recorded
  // quantity gets subtracted back out via the delta logic.
  const isVoid = isVoidOrder(payload);

  const lineItems = isVoid
    ? []
    : (payload?.line_items ?? []).map((item) => ({
        sku: item.sku,
        // Confirmed on a dev store: line_items[].quantity stays at the
        // ORIGINAL value, while current_quantity excludes removed and
        // refunded units (see effectiveQuantity). An order edited 3 -> 2
        // now counts 2.
        quantity: effectiveQuantity(item),
      }));

  const sourceUpdatedAt = resolveSourceVersion(triggeredAt, payload.updated_at, new Date());
  const result = await recordOrderUsage(
    shop,
    String(payload.id),
    new Date(payload.created_at),
    lineItems,
    sourceUpdatedAt,
  );
  console.log(
    `Reconciled usage for order ${payload.id} (${lineItems.length} line items, void=${isVoid}, ${result.action})`,
  );

  return new Response();
};
