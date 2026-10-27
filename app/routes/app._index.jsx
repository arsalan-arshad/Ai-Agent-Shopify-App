import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
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
  EmptyState,
  Link,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../lib/shopify.server.js";
import { buildForecastSnapshot } from "../lib/forecast-snapshot.server.js";
import { getTrackedSkus } from "../lib/usage-history.server.js";
import { backfillUsageHistory } from "../lib/backfill.server.js";
import { getShopAiSettings } from "../lib/ai-settings.server.js";
import { preorderDisplayFigures } from "../lib/preorder.js";

/**
 * Usage history comes from the DailyUsage table, populated continuously by
 * the orders webhook (app/routes/webhooks.orders-updated.jsx).
 *
 * First-run: on install, if getTrackedSkus(shop) returns empty, we trigger
 * backfillUsageHistory() in the background (fire-and-forget) so the
 * merchant sees useful numbers on day one instead of "no data yet".
 */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [trackedSkus, aiSettings] = await Promise.all([
    getTrackedSkus(shop),
    getShopAiSettings(shop),
  ]);
  const hasAiKey = !!aiSettings;

  let forecastSnapshot = [];
  let loadError = null;
  try {
    forecastSnapshot = await buildForecastSnapshot(admin, shop);
  } catch (err) {
    console.error(`buildForecastSnapshot failed for ${shop}:`, err);
    loadError = "Couldn't load inventory data from Shopify. Try reloading the page.";
  }

  if (trackedSkus.length === 0) {
    // Fire-and-forget, after the critical page query, to avoid racing it
    // for API rate limit.
    backfillUsageHistory(admin, shop, { maxPages: 10 }).catch((err) => {
      console.error(`Backfill failed for ${shop}:`, err);
    });
  }

  return json({
    forecastSnapshot,
    loadError,
    isBackfilling: trackedSkus.length === 0,
    hasAiKey,
  });
};

const statusBadge = {
  reorder_now: <Badge tone="critical">Reorder now</Badge>,
  reorder_soon: <Badge tone="warning">Reorder soon</Badge>,
  healthy: <Badge tone="success">Healthy</Badge>,
  no_recent_sales: <Badge>No recent sales</Badge>,
};

function truncateTitle(title, max = 28) {
  if (!title || title.length <= max) return title;
  return `${title.slice(0, max - 1)}…`;
}

function formatLocations(locations) {
  if (!locations || locations.length === 0) return "—";
  if (locations.length === 1) return locations[0].name ?? "1 location";
  return `${locations.length} locations`;
}

/**
 * Gets a fresh Shopify session (ID) token from App Bridge and attaches it
 * as a Bearer token, then POSTs form-encoded data.
 *
 * Why not Remix's useFetcher()/<Form>? Those submit via a plain fetch()
 * call. With `unstable_newEmbeddedAuthStrategy` (token exchange), every
 * authenticated request needs a valid session token attached — normally
 * App Bridge's own fetch patch does this automatically for same-origin
 * calls, but in practice (confirmed via Shopify's own community reports of
 * App Bridge v4's automatic fetch authorization) that token can be stale
 * or briefly undefined depending on timing, and Remix's fetcher never
 * retries or surfaces that failure — the request just silently returns
 * nothing usable. Asking App Bridge for a token explicitly, right before
 * the call, avoids that class of bug entirely.
 */
async function postWithSessionToken(path, formData) {
  if (!window.shopify?.idToken) {
    throw new Error("App Bridge isn't ready yet — please reload the page and try again.");
  }
  const token = await window.shopify.idToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  let data = null;
  let parseError = null;
  try {
    data = await res.json();
  } catch (err) {
    // Non-JSON response — commonly an auth-bounce redirect the browser
    // silently followed to an HTML page, or an infra-level error page
    // (e.g. the dev tunnel's own gateway error) that never reached our
    // server code. This must still surface to the caller: previously a
    // 200-status non-JSON response (exactly what an auth bounce returns)
    // fell through as a silent no-op — the button's loading state would
    // clear with no banner, toast, or answer, and no way to tell what
    // happened.
    parseError = err;
  }
  if (parseError) {
    throw new Error(
      res.ok
        ? "Got an unexpected response from the server — your session may have expired. Please reload the page and try again."
        : `Request failed (HTTP ${res.status}).`,
    );
  }
  // A parsed JSON body — even on a non-2xx status — carries the server's
  // own specific error message (see the action in this route / api.agent-chat.jsx).
  // Return it so callers can show that message instead of a bare
  // "Request failed (HTTP 502)." that throws away the real reason.
  return data;
}

export default function Dashboard() {
  const { forecastSnapshot, loadError, isBackfilling, hasAiKey } = useLoaderData();
  const [question, setQuestion] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  const [toastError, setToastError] = useState(false);
  const [asking, setAsking] = useState(false);
  const [chatResult, setChatResult] = useState(null);

  const showToast = (message, { error = false } = {}) => {
    setToastError(error);
    setToastMessage(message);
  };

  const preorderCandidates = forecastSnapshot.filter(
    (item) => item.preorder?.recommendation?.state === "candidate",
  );
  const staleRestockItems = forecastSnapshot.filter(
    (item) => item.preorder?.staleRestockDate,
  );

  const handleCopySummary = async (summary) => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      showToast("Copied summary — paste it into your pre-order app.");
    } catch (err) {
      console.error("Clipboard write failed:", err);
      showToast("Couldn't copy — select the summary text manually.", { error: true });
    }
  };

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setChatResult(null);
    try {
      const fd = new FormData();
      fd.set("question", question);
      const data = await postWithSessionToken("/api/agent-chat", fd);
      setChatResult(data);
      if (data?.error && !data?.needsSetup) {
        showToast(data.error, { error: true });
      }
    } catch (err) {
      console.error("Ask the forecast agent failed:", err);
      showToast(err.message || "Couldn't reach the forecast agent. Please try again.", {
        error: true,
      });
    } finally {
      setAsking(false);
    }
  };

  const rows = forecastSnapshot.map((item) => [
    item.sku,
    truncateTitle(item.title),
    item.currentStock,
    formatLocations(item.locations),
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
            <BlockStack gap="400">
            {loadError && (
              <Banner tone="critical" title="Couldn't load your inventory">
                <p>{loadError}</p>
              </Banner>
            )}

            {staleRestockItems.length > 0 && (
              <Banner tone="warning" title="Update past restock dates">
                <p>
                  {staleRestockItems.length === 1
                    ? `SKU ${staleRestockItems[0].sku} has a restock date in the past (${staleRestockItems[0].preorder.restockDate}).`
                    : `${staleRestockItems.length} SKUs have restock dates in the past.`}{" "}
                  Refresh the expected arrival in{" "}
                  <Link url="/app/settings">Settings</Link> so gap
                  recommendations stay accurate.
                </p>
              </Banner>
            )}

            {preorderCandidates.map((item) => {
              const rec = item.preorder.recommendation;
              const summary = item.preorder.summary;
              const display = preorderDisplayFigures({
                daysOfCover: item.daysOfCover,
                gapDays: rec.gapDays,
                switchOnDay: rec.switchOnDay,
                avgDailyUsage: item.avgDailyUsage,
                restockDay: item.preorder.restockDay,
              });
              const gapSingular = display.gap === 1;
              return (
                <Card key={`preorder-${item.sku}`}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <Text as="h2" variant="headingMd">
                        Pre-order gap: {item.sku}
                      </Text>
                      <Badge tone="warning">Recommend only</Badge>
                    </InlineStack>
                    <Text as="p">
                      {item.title && item.title !== item.sku ? `${item.title} · ` : ""}
                      Stockout ~day {display.cover}
                      , restock {item.preorder.restockDate}
                      {" "}(day {display.restock ?? "—"})
                      — gap {display.gap} day{gapSingular ? "" : "s"}
                      , ~{display.units} units at risk.
                      Suggested switch-on around day {display.switchOn ?? "—"}.
                    </Text>
                    <Text as="p" tone="subdued">
                      This app does not change your catalog. Copy the summary
                      into your existing pre-order app, or set restock dates in{" "}
                      <Link url="/app/settings">Settings</Link>.
                    </Text>
                    {summary && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          <span style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                            {summary}
                          </span>
                        </Text>
                        <Button onClick={() => handleCopySummary(summary)}>
                          Copy summary
                        </Button>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              );
            })}

            <Card>
              {forecastSnapshot.length === 0 && !loadError ? (
                <EmptyState
                  heading={
                    isBackfilling
                      ? "Building your forecast from order history..."
                      : "No SKUs with sales history yet"
                  }
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {isBackfilling
                      ? "We're pulling in your recent orders to seed the forecast. This runs in the background — reload in a minute or two."
                      : "Once orders come in for your products, this table will fill in with reorder points and days of cover."}
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "SKU",
                    "Product",
                    "Stock",
                    "Locations",
                    "Avg/day",
                    "Cover",
                    "Reorder",
                    "Status",
                  ]}
                  rows={rows}
                />
              )}
            </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Ask the forecast agent
                </Text>
                {!hasAiKey && (
                  <Banner tone="warning" title="Add your AI provider API key to turn this on">
                    <p>
                      This app is free and has no shared AI key — add your own Gemini or
                      Claude API key in Settings to enable the chat. The forecast table
                      above works without it.
                    </p>
                    <Link url="/app/settings">Go to Settings</Link>
                  </Banner>
                )}
                <TextField
                  label="Question"
                  labelHidden
                  value={question}
                  onChange={setQuestion}
                  placeholder="What should I reorder before next week?"
                  autoComplete="off"
                  multiline={2}
                  disabled={!hasAiKey}
                />
                <Button onClick={handleAsk} loading={asking} disabled={!hasAiKey}>
                  Ask
                </Button>
                {chatResult?.needsSetup && (
                  <Banner tone="info" title="AI insights aren't set up yet">
                    <p>
                      {chatResult.error}{" "}
                      <Link url="/app/settings">Go to Settings</Link>
                    </p>
                  </Banner>
                )}
                {chatResult?.answer && <Text as="p">{chatResult.answer}</Text>}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastMessage && (
        <Toast
          content={toastMessage}
          error={toastError}
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </Frame>
  );
}
