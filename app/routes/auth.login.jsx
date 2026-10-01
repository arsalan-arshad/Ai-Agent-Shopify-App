import { login } from "../lib/shopify.server.js";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";

/**
 * Fallback route for anyone who lands on the app's bare URL outside the
 * normal Shopify-initiated install/open flow (App Store "Add app" button,
 * Partner Dashboard dev-store link, or opening the app from Shopify
 * Admin) -- all of those already append `?shop=xxx.myshopify.com`, so
 * `login()` below redirects straight into OAuth before this ever renders.
 *
 * This intentionally does NOT prompt for manual shop-domain entry
 * (Shopify App Store requirement 2.3.1: apps must not request manual
 * entry of a myshopify.com URL during install). If `login()` doesn't
 * redirect (no `shop` param present), we just point the merchant back to
 * a real Shopify-owned entry point instead of collecting the domain
 * ourselves.
 */
export const loader = async ({ request }) => {
  await login(request);
  return null;
};

export default function Auth() {
  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Install Agent Forecast from the Shopify App Store
          </Text>
          <Text as="p">
            Open this app from your Shopify admin, or install it from the
            Shopify App Store. Installing directly from this link isn't
            supported.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
