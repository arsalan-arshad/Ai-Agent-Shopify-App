import { useEffect, useState } from "react";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  TextField,
  Button,
  BlockStack,
  Text,
  Frame,
  Toast,
} from "@shopify/polaris";
import { authenticate } from "../lib/shopify.server.js";
import { INVENTORY_LEVELS_QUERY } from "../graphql/queries.js";
import {
  calculateReorderPoint,
  daysOfCover,
  classifyStockStatus,
} from "../lib/forecasting.js";
import {
  getUsageHistory,
  getLeadTimeDays,
  getTrackedSkus,
} from "../lib/usage-history.server.js";
import { backfillUsageHistory } from "../lib/backfill.server.js";

/**
 * Orders are no longer queried live here — usage history now comes from
 * the DailyUsage table, populated continuously by the orders webhook
 * (app/routes/webhooks.orders-updated.jsx). This is both more accurate
 * (real historical trend, not just "last 100 orders") and cheaper
 * (one inventory query per page load instead of an orders query too).
 *
 * First-run optimization: on install, if getTrackedSkus(shop) returns empty,
 * we trigger backfillUsageHistory() in the background. This seeds the forecast
 * with historical order data, so the merchant sees useful numbers on day one
 * instead of "no data yet". Backfill is fire-and-forget (background promise)
 * so the page load stays snappy.
 */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Check if this is a first-time install
  const trackedSkus = await getTrackedSkus(shop);

  const inventoryRes = await admin.graphql(INVENTORY_LEVELS_QUERY, {
    variables: { first: 50 },
  });
  const inventoryJson = await inventoryRes.json();

  const forecastSnapshot = await buildForecastSnapshot(shop, inventoryJson);

  if (trackedSkus.length === 0) {
    // Trigger backfill in background (fire-and-forget), after the critical
    // page query has already completed to avoid racing it for API rate limit.
    backfillUsageHistory(admin, shop, { maxPages: 10 }).catch((err) => {
      console.error(`Backfill failed for ${shop}:`, err);
    });
  }

  return json({ forecastSnapshot });
};

async function buildForecastSnapshot(shop, inventoryJson) {
  const items = inventoryJson?.data?.inventoryItems?.edges ?? [];

  return Promise.all(
    items
      .filter(({ node }) => !!node.sku)
      .map(async ({ node }) => {
      const available =
        node.inventoryLevels?.edges?.[0]?.node?.quantities?.[0]?.quantity ?? 0;

      const sku = node.sku;
      const leadTimeDays = await getLeadTimeDays(shop, sku);
      const history = await getUsageHistory(shop, sku, 30);

      const { avgDailyUsage, reorderPoint } = calculateReorderPoint({
        dailyUsageHistory: history,
        leadTimeDays,
      });

      const cover = daysOfCover(available, avgDailyUsage);
      const status = classifyStockStatus({
        daysOfCover: cover,
        leadTimeDays,
      });

      return {
        sku,
        title: node.variant?.displayName ?? sku,
        currentStock: available,
        avgDailyUsage,
        daysOfCover: cover,
        reorderPoint,
        status,
        leadTimeDays,
        daysOfDataCollected: history.filter((h) => h > 0).length,
      };
    }),
  );
}

const statusBadge = {
  reorder_now: <Badge tone="critical">Reorder now</Badge>,
  reorder_soon: <Badge tone="warning">Reorder soon</Badge>,
  healthy: <Badge tone="success">Healthy</Badge>,
  no_recent_sales: <Badge>No recent sales</Badge>,
};

export default function Dashboard() {
  const { forecastSnapshot } = useLoaderData();
  const [question, setQuestion] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  const [clickCount, setClickCount] = useState(0);
  const fetcher = useFetcher();

  const handleAsk = () => {
    setClickCount((c) => c + 1);
    fetcher.submit(
      { question, snapshot: JSON.stringify(forecastSnapshot) },
      { method: "post", action: "/api/agent-chat" },
    );
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      setToastMessage(fetcher.data.error);
    }
  }, [fetcher.data]);

  const rows = forecastSnapshot.map((item) => [
    item.sku,
    item.title,
    item.currentStock,
    item.avgDailyUsage,
    item.daysOfCover === Infinity ? "—" : item.daysOfCover,
    item.reorderPoint,
    statusBadge[item.status],
  ]);

  return (
    <Frame>
      <Page title="Inventory Forecast Agent">
      <Layout>
        <Layout.Section>
          <Card>
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "numeric",
                "numeric",
                "numeric",
                "numeric",
                "text",
              ]}
              headings={[
                "SKU",
                "Product",
                "In stock",
                "Avg daily usage",
                "Days of cover",
                "Reorder point",
                "Status",
              ]}
              rows={rows}
            />
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Ask the forecast agent
              </Text>
              <TextField
                label="Question"
                labelHidden
                value={question}
                onChange={setQuestion}
                placeholder="What should I reorder before next week?"
                autoComplete="off"
                multiline={2}
              />
              <Button onClick={handleAsk} loading={fetcher.state !== "idle"}>
                Ask
              </Button>
              <Text as="p" tone="subdued">
                debug: clicks={clickCount} fetcherState={fetcher.state}{" "}
                hasAnswer={String(!!fetcher.data?.answer)} hasError=
                {String(!!fetcher.data?.error)}
              </Text>
              {fetcher.data?.answer && (
                <Text as="p">{fetcher.data.answer}</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      </Page>
      {toastMessage && (
        <Toast
          content={toastMessage}
          error
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </Frame>
  );
}
