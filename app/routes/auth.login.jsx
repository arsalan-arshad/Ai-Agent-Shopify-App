import { redirect } from "@remix-run/node";
import { authenticate } from "../lib/shopify.server";

/**
 * OAuth login initiation route.
 * Shopify's authenticate.admin() handles the OAuth flow.
 * This redirects unauthenticated users to Shopify's login.
 */
export const loader = async ({ request }) => {
  return await authenticate.admin(request);
};
