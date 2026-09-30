import { authenticate } from "../lib/shopify.server.js";

/**
 * Mandatory compliance webhook: a customer (via the merchant, or Shopify
 * directly) has requested a copy of their data. This app does not store
 * any customer-identifying data — DailyUsage is aggregated per SKU per
 * day (shop, sku, date, quantity) with no customer/order/PII fields, and
 * Session rows hold shop-level OAuth tokens, not customer data. There is
 * nothing customer-specific to export.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(
    `Received ${topic} for ${shop} (customer ${payload?.customer?.id}) — no customer data stored, nothing to export.`,
  );
  return new Response();
};
