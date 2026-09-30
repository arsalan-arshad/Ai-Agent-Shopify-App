import { authenticate } from "../lib/shopify.server.js";

/**
 * Catch-all for any /auth/* path not matched by a more specific route
 * (auth.login.jsx, auth.callback.jsx). Matches the official
 * shopify-app-template-remix pattern — authenticate.admin(request)
 * inspects the path itself and does the right thing (start OAuth, handle
 * the callback, etc.), so this is a safety net for any auth sub-path
 * Shopify hits that isn't one of our two explicit routes.
 */
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};
