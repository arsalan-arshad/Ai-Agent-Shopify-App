import { authenticate } from "../lib/shopify.server.js";

/**
 * Mandatory compliance webhook: redact a specific customer's data 10 days
 * after a redaction request. This app does not store any
 * customer-identifying data (see webhooks.customers.data_request.jsx for
 * why), so there is nothing to redact here.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(
    `Received ${topic} for ${shop} (customer ${payload?.customer?.id}) — no customer data stored, nothing to redact.`,
  );
  return new Response();
};
