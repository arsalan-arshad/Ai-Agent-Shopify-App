import { authenticate } from "../lib/shopify.server";

/**
 * OAuth callback route. Listed in shopify.app.toml under [auth] redirect_urls.
 * The authenticate.admin() function handles token exchange and session creation.
 * On success, redirects to /app.
 */
export const loader = async ({ request }) => {
  return await authenticate.admin(request);
};
