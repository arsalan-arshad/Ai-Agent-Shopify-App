import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

/**
 * Root loader intentionally does NOT call authenticate.admin(). This route
 * runs for every request in the tree, including /auth/* routes — gating it
 * here as well as in app.jsx (the actual protected layout) is redundant,
 * and worse, wrapping authenticate.admin() in try/catch (as a previous
 * version of this file did) silently swallows the Response it throws to
 * trigger an OAuth/exit-iframe redirect. Auth belongs to app.jsx and any
 * other route that actually needs a session; root just needs the API key
 * for the App Bridge script tag below.
 */
export const loader = async () => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY });
};

export default function App() {
  const { apiKey } = useLoaderData();
  const { pathname } = useLocation();
  // App Bridge only works inside the Shopify admin; on public pages like
  // /auth/login it throws "missing required configuration fields: shop".
  const isAdminPage = pathname === "/app" || pathname.startsWith("/app/");

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {isAdminPage && (
          <>
            <meta name="shopify-api-key" content={apiKey} />
            <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
          </>
        )}
        <title>Inventory Forecast Agent</title>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Error boundary for uncaught exceptions.
 * Remix will render this when a route throws or returns an error response.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <html>
      <head>
        <title>Error</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ padding: "1rem" }}>
          {isRouteErrorResponse(error) ? (
            <div>
              <h1>
                {error.status} {error.statusText}
              </h1>
              <p>{error.data?.message}</p>
            </div>
          ) : error instanceof Error ? (
            <div>
              <h1>Error</h1>
              <p>{error.message}</p>
            </div>
          ) : (
            <h1>Unknown Error</h1>
          )}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
