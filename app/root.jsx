import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "./lib/shopify.server";

/**
 * Root loader: initialize session and pass API key to client for App Bridge.
 * Unauthenticated routes (like /auth/login) skip this via the authenticate.unauthenticated() path.
 */
export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    return json({
      apiKey: process.env.SHOPIFY_API_KEY,
      shop: session?.shop,
    });
  } catch {
    // Unauthenticated route; no session available
    return json({
      apiKey: process.env.SHOPIFY_API_KEY,
      shop: null,
    });
  }
};

export default function App() {
  const { apiKey, shop } = useLoaderData();

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
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
