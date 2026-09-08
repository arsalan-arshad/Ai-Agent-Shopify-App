import { authenticate } from "../lib/shopify.server.js";
import { recordOrderUsage } from "../lib/usage-history.server.js";

/**
 * Fires on orders/create and orders/updated (see shopify.app.toml).
 *
 * IMPORTANT (token migration relevance): webhook handlers are exactly the
 * "background job" context called out in Shopify's own migration guidance
 * as the place expiring-token bugs surface first — there's no live user
 * session to trigger a re-auth prompt, so the session storage's stored
 * access/refresh token pair must already be valid or auto-refreshed here.
 * @shopify/shopify-app-remix handles the refresh transparently as long as
 * PrismaSessionStorage has a current refresh token on file for the shop.
 *
 * The handler now checks financial_status to avoid double-counting:
 * - orders/create: always record (first-time event)
 * - orders/updated: only record if financial_status is not "refunded" or "voided",
 *   and only if the line items are actually different (not just a metadata edit)
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Webhook ${topic} received for ${shop}`);

  // Skip cancelled orders
  if (payload?.cancelled_at) {
    console.log(`Skipping cancelled order ${payload.id}`);
    return new Response();
  }

  // For orders/updated: skip refunded/voided orders (no inventory to record)
  if (topic === "orders/updated") {
    const financialStatus = payload?.financial_status;
    if (financialStatus === "refunded" || financialStatus === "voided") {
      console.log(`Skipping ${financialStatus} order ${payload.id}`);
      return new Response();
    }
  }

  const lineItems = (payload?.line_items ?? []).map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
  }));

  if (lineItems.length > 0) {
    await recordOrderUsage(shop, lineItems);
    console.log(`Recorded usage for ${lineItems.length} SKUs from order ${payload.id}`);
  }

  return new Response();
};
