import { redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { authenticate } from "../lib/shopify.server";

/**
 * App layout route: protects all routes matching app.* pattern.
 * This ensures authentication happens before accessing any admin app route.
 * On success, `session` is available to all child routes.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // First app load without usage history? Trigger backfill in the background
  // (see app._index.jsx for the full implementation)

  return { shop: session.shop };
};

export default function AppLayout() {
  return <Outlet />;
}
