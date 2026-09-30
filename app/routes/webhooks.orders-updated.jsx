import { authenticate } from "../lib/shopify.server.js";
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
 * IDEMPOTENCY: orders/updated fires on nearly any edit to an order, not
 * just ones that change what was sold, and Shopify can redeliver any
 * webhook. recordOrderUsage (usage-history.server.js) tracks the last
 * line-item snapshot per order ID and only applies the delta, so repeated
 * or edited deliveries for the same order don't double-count.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} received for ${shop}, order ${payload?.id}`);

  if (!payload?.id || !payload?.created_at) {
    console.warn(`Webhook ${topic} for ${shop} missing id/created_at, skipping`);
    return new Response();
  }

  // Cancelled/refunded/voided orders have no inventory impact worth
  // tracking as "usage" — treat as zero line items so a prior recorded
  // quantity gets subtracted back out via the delta logic.
  const financialStatus = payload?.financial_status;
  const isVoid =
    !!payload?.cancelled_at ||
    financialStatus === "refunded" ||
    financialStatus === "voided";

  const lineItems = isVoid
    ? []
    : (payload?.line_items ?? []).map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      }));

  await recordOrderUsage(shop, String(payload.id), new Date(payload.created_at), lineItems);
  console.log(
    `Reconciled usage for order ${payload.id} (${lineItems.length} line items, void=${isVoid})`,
  );

  return new Response();
};
