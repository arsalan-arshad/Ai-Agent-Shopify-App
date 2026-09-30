import { Outlet } from "@remix-run/react";
import { authenticate } from "../lib/shopify.server";

/**
 * App layout route: protects all routes matching app.* pattern.
 * This ensures authentication happens before accessing any admin app route.
 * On success, `session` is available to all child routes.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export default function AppLayout() {
  return (
    <>
      {/* App Bridge nav menu web component — app-bridge.js is loaded via a
          <script> tag in root.jsx, which defines this custom element, so it
          works without the @shopify/app-bridge-react <Provider> wrapper. */}
      <ui-nav-menu>
        <a href="/app" rel="home">
          Dashboard
        </a>
        <a href="/app/settings">Settings</a>
      </ui-nav-menu>
      <Outlet />
    </>
  );
}
