var _a;
import { jsx, jsxs } from "react/jsx-runtime";
import { createReadableStreamFromReadable, json, redirect } from "@remix-run/node";
import { RemixServer, useLoaderData, Meta, Links, Outlet, ScrollRestoration, Scripts, useRouteError, isRouteErrorResponse, useFetcher } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "stream";
import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import { AppProvider, Frame, Page, Layout, Card, DataTable, BlockStack, Text, TextField, Button, Toast, Badge } from "@shopify/polaris";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { useState, useEffect } from "react";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.January25,
  scopes: (_a = process.env.SCOPES) == null ? void 0 : _a.split(","),
  appUrl: process.env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true
  }
});
const authenticate = shopify.authenticate;
shopify.unauthenticated;
shopify.sessionStorage;
const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, remixContext, _loadContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(RemixServer, { context: remixContext, url: request.url }),
      {
        [callbackName]: () => {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        }
      }
    );
    setTimeout(abort, streamTimeout + 1e3);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const loader$5 = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    return json({
      apiKey: process.env.SHOPIFY_API_KEY,
      shop: session == null ? void 0 : session.shop
    });
  } catch {
    return json({
      apiKey: process.env.SHOPIFY_API_KEY,
      shop: null
    });
  }
};
function App() {
  const { apiKey, shop } = useLoaderData();
  return /* @__PURE__ */ jsxs("html", { children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx("meta", { charSet: "utf-8" }),
      /* @__PURE__ */ jsx("meta", { name: "viewport", content: "width=device-width,initial-scale=1" }),
      /* @__PURE__ */ jsx("meta", { name: "shopify-api-key", content: apiKey }),
      /* @__PURE__ */ jsx("script", { src: "https://cdn.shopify.com/shopifycloud/app-bridge.js" }),
      /* @__PURE__ */ jsx("title", { children: "Inventory Forecast Agent" }),
      /* @__PURE__ */ jsx(Meta, {}),
      /* @__PURE__ */ jsx(Links, {})
    ] }),
    /* @__PURE__ */ jsxs("body", { children: [
      /* @__PURE__ */ jsx(AppProvider, { i18n: {}, children: /* @__PURE__ */ jsx(Outlet, {}) }),
      /* @__PURE__ */ jsx(ScrollRestoration, {}),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
function ErrorBoundary() {
  var _a2;
  const error = useRouteError();
  return /* @__PURE__ */ jsxs("html", { children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx("title", { children: "Error" }),
      /* @__PURE__ */ jsx(Meta, {}),
      /* @__PURE__ */ jsx(Links, {})
    ] }),
    /* @__PURE__ */ jsxs("body", { children: [
      /* @__PURE__ */ jsx("div", { style: { padding: "1rem" }, children: isRouteErrorResponse(error) ? /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("h1", { children: [
          error.status,
          " ",
          error.statusText
        ] }),
        /* @__PURE__ */ jsx("p", { children: (_a2 = error.data) == null ? void 0 : _a2.message })
      ] }) : error instanceof Error ? /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h1", { children: "Error" }),
        /* @__PURE__ */ jsx("p", { children: error.message })
      ] }) : /* @__PURE__ */ jsx("h1", { children: "Unknown Error" }) }),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  default: App,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
async function recordOrderUsage(shop, lineItems) {
  const today = startOfDay(/* @__PURE__ */ new Date());
  for (const item of lineItems) {
    const sku = item.sku;
    if (!sku) continue;
    await prisma.dailyUsage.upsert({
      where: {
        shop_sku_date: { shop, sku, date: today }
      },
      update: {
        quantity: { increment: item.quantity }
      },
      create: {
        shop,
        sku,
        date: today,
        quantity: item.quantity
      }
    });
  }
}
async function getUsageHistory(shop, sku, days = 30) {
  const since = startOfDay(/* @__PURE__ */ new Date());
  since.setDate(since.getDate() - days);
  const rows = await prisma.dailyUsage.findMany({
    where: { shop, sku, date: { gte: since } },
    orderBy: { date: "asc" }
  });
  const byDate = new Map(
    rows.map((r) => [r.date.toISOString().slice(0, 10), r.quantity])
  );
  const history = [];
  const cursor = new Date(since);
  const now = startOfDay(/* @__PURE__ */ new Date());
  while (cursor <= now) {
    const key = cursor.toISOString().slice(0, 10);
    history.push(byDate.get(key) ?? 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  return history;
}
async function getTrackedSkus(shop) {
  const rows = await prisma.dailyUsage.groupBy({
    by: ["sku"],
    where: { shop }
  });
  return rows.map((r) => r.sku);
}
async function getLeadTimeDays(shop, sku) {
  const skuSetting = await prisma.leadTimeSetting.findUnique({
    where: { shop_sku_leadtime: { shop, sku } }
  });
  if (skuSetting) return skuSetting.leadTimeDays;
  const shopDefault = await prisma.leadTimeSetting.findFirst({
    where: { shop, sku: null }
  });
  if (shopDefault) return shopDefault.leadTimeDays;
  return 14;
}
function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
const action$1 = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Webhook ${topic} received for ${shop}`);
  if (payload == null ? void 0 : payload.cancelled_at) {
    console.log(`Skipping cancelled order ${payload.id}`);
    return new Response();
  }
  if (topic === "orders/updated") {
    const financialStatus = payload == null ? void 0 : payload.financial_status;
    if (financialStatus === "refunded" || financialStatus === "voided") {
      console.log(`Skipping ${financialStatus} order ${payload.id}`);
      return new Response();
    }
  }
  const lineItems = ((payload == null ? void 0 : payload.line_items) ?? []).map((item) => ({
    sku: item.sku,
    quantity: item.quantity
  }));
  if (lineItems.length > 0) {
    await recordOrderUsage(shop, lineItems);
    console.log(`Recorded usage for ${lineItems.length} SKUs from order ${payload.id}`);
  }
  return new Response();
};
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1
}, Symbol.toStringTag, { value: "Module" }));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function askForecastAgent(question, forecastSnapshot) {
  var _a2;
  const systemPrompt = `You are an inventory planning assistant embedded in a Shopify app.
You answer merchant questions ONLY using the forecast data provided below.
Never invent sales numbers, stock levels, or dates that aren't in the data.
If the data doesn't cover what's being asked, say so plainly and suggest
what data would be needed instead.
Keep answers short, concrete, and action-oriented — merchants are busy.
When you recommend an action (reorder now, order X units, etc.), name the
specific SKU and the number backing that recommendation.

Current forecast snapshot (JSON):
${JSON.stringify(forecastSnapshot, null, 2)}`;
  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: question,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
      thinkingConfig: {
        thinkingBudget: 128
      }
    }
  });
  return ((_a2 = response.text) == null ? void 0 : _a2.trim()) || "I couldn't generate a response — please try rephrasing.";
}
const dlog = (msg) => {
  try {
    fs.appendFileSync("/tmp/agent-chat-debug.log", `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
  } catch {
  }
};
const action = async ({ request }) => {
  dlog("HIT action route");
  try {
    await authenticate.admin(request);
    dlog("authenticate.admin OK");
  } catch (authErr) {
    dlog(`authenticate.admin FAILED: ${(authErr == null ? void 0 : authErr.message) ?? authErr}`);
    throw authErr;
  }
  const formData = await request.formData();
  const question = formData.get("question");
  const snapshot = JSON.parse(formData.get("snapshot") ?? "[]");
  dlog(`question=${question}`);
  if (!question || typeof question !== "string") {
    return json({ error: "Question is required." }, { status: 400 });
  }
  try {
    const answer = await askForecastAgent(question, snapshot);
    dlog(`answer received, length=${answer == null ? void 0 : answer.length}`);
    return json({ answer });
  } catch (err) {
    dlog(`askForecastAgent FAILED: status=${err == null ? void 0 : err.status} message=${err == null ? void 0 : err.message}`);
    console.error("askForecastAgent failed:", err);
    const message = (err == null ? void 0 : err.status) === 401 || (err == null ? void 0 : err.status) === 403 ? "AI agent is not configured correctly (invalid or missing Gemini API key)." : (err == null ? void 0 : err.status) === 404 ? "AI agent's model is unavailable — the Gemini model name may be outdated." : (err == null ? void 0 : err.status) === 429 ? "AI agent hit its free-tier rate limit. Please wait a moment and try again." : "The AI agent couldn't answer right now. Please try again in a moment.";
    return json({ error: message }, { status: 502 });
  }
};
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action
}, Symbol.toStringTag, { value: "Module" }));
const loader$4 = async ({ request }) => {
  return await authenticate.admin(request);
};
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const RECENT_ORDERS_QUERY = `#graphql
  query RecentOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                quantity
                sku
                title
                variant {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;
const INVENTORY_LEVELS_QUERY = `#graphql
  query InventoryLevels($first: Int!) {
    inventoryItems(first: $first) {
      edges {
        node {
          id
          sku
          variant {
            displayName
          }
          inventoryLevels(first: 5) {
            edges {
              node {
                location {
                  name
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;
function weightedMovingAverage(history, periods = 4) {
  const recent = history.slice(-periods);
  if (recent.length === 0) return 0;
  const weights = recent.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weighted = recent.reduce(
    (sum, value, i) => sum + value * weights[i],
    0
  );
  return weighted / weightSum;
}
function calculateReorderPoint({
  dailyUsageHistory,
  leadTimeDays,
  serviceLevelZ = 1.65
}) {
  const avgDailyUsage = weightedMovingAverage(dailyUsageHistory, 14);
  const mean = dailyUsageHistory.reduce((a, b) => a + b, 0) / dailyUsageHistory.length;
  const variance = dailyUsageHistory.reduce((sum, v) => sum + (v - mean) ** 2, 0) / dailyUsageHistory.length;
  const stdDev = Math.sqrt(variance);
  const safetyStock = serviceLevelZ * stdDev * Math.sqrt(leadTimeDays);
  const reorderPoint = avgDailyUsage * leadTimeDays + safetyStock;
  return {
    avgDailyUsage: round2(avgDailyUsage),
    safetyStock: round2(safetyStock),
    reorderPoint: round2(reorderPoint)
  };
}
function daysOfCover(currentStock, avgDailyUsage) {
  if (avgDailyUsage <= 0) return Infinity;
  return round2(currentStock / avgDailyUsage);
}
function classifyStockStatus({ daysOfCover: daysOfCover2, leadTimeDays }) {
  if (daysOfCover2 === Infinity) return "no_recent_sales";
  if (daysOfCover2 <= leadTimeDays) return "reorder_now";
  if (daysOfCover2 <= leadTimeDays * 1.5) return "reorder_soon";
  return "healthy";
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
async function backfillUsageHistory(admin, shop, { maxPages = 5 } = {}) {
  var _a2, _b, _c, _d, _e, _f, _g;
  let cursor = null;
  let pagesRead = 0;
  const dailyTotals = /* @__PURE__ */ new Map();
  while (pagesRead < maxPages) {
    const response = await admin.graphql(RECENT_ORDERS_QUERY, {
      variables: { first: 50, after: cursor }
    });
    const json2 = await response.json();
    const edges = ((_b = (_a2 = json2 == null ? void 0 : json2.data) == null ? void 0 : _a2.orders) == null ? void 0 : _b.edges) ?? [];
    for (const { node: order } of edges) {
      const day = order.createdAt.slice(0, 10);
      const lineItemEdges = ((_c = order.lineItems) == null ? void 0 : _c.edges) ?? [];
      for (const { node: item } of lineItemEdges) {
        if (!item.sku) continue;
        const key = `${item.sku}|${day}`;
        dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + item.quantity);
      }
    }
    const hasNext = (_f = (_e = (_d = json2 == null ? void 0 : json2.data) == null ? void 0 : _d.orders) == null ? void 0 : _e.pageInfo) == null ? void 0 : _f.hasNextPage;
    if (!hasNext) break;
    cursor = ((_g = edges[edges.length - 1]) == null ? void 0 : _g.cursor) ?? null;
    pagesRead += 1;
  }
  for (const [key, quantity] of dailyTotals) {
    const [sku, day] = key.split("|");
    const date = /* @__PURE__ */ new Date(`${day}T00:00:00.000Z`);
    await prisma.dailyUsage.upsert({
      where: { shop_sku_date: { shop, sku, date } },
      update: { quantity },
      create: { shop, sku, date, quantity }
    });
  }
  return {
    skusSeeded: new Set([...dailyTotals.keys()].map((k) => k.split("|")[0])).size,
    daysProcessed: dailyTotals.size
  };
}
const loader$3 = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const trackedSkus = await getTrackedSkus(shop);
  const inventoryRes = await admin.graphql(INVENTORY_LEVELS_QUERY, {
    variables: { first: 50 }
  });
  const inventoryJson = await inventoryRes.json();
  const forecastSnapshot = await buildForecastSnapshot(shop, inventoryJson);
  if (trackedSkus.length === 0) {
    backfillUsageHistory(admin, shop, { maxPages: 10 }).catch((err) => {
      console.error(`Backfill failed for ${shop}:`, err);
    });
  }
  return json({ forecastSnapshot });
};
async function buildForecastSnapshot(shop, inventoryJson) {
  var _a2, _b;
  const items = ((_b = (_a2 = inventoryJson == null ? void 0 : inventoryJson.data) == null ? void 0 : _a2.inventoryItems) == null ? void 0 : _b.edges) ?? [];
  return Promise.all(
    items.filter(({ node }) => !!node.sku).map(async ({ node }) => {
      var _a3, _b2, _c, _d, _e, _f, _g;
      const available = ((_f = (_e = (_d = (_c = (_b2 = (_a3 = node.inventoryLevels) == null ? void 0 : _a3.edges) == null ? void 0 : _b2[0]) == null ? void 0 : _c.node) == null ? void 0 : _d.quantities) == null ? void 0 : _e[0]) == null ? void 0 : _f.quantity) ?? 0;
      const sku = node.sku;
      const leadTimeDays = await getLeadTimeDays(shop, sku);
      const history = await getUsageHistory(shop, sku, 30);
      const { avgDailyUsage, reorderPoint } = calculateReorderPoint({
        dailyUsageHistory: history,
        leadTimeDays
      });
      const cover = daysOfCover(available, avgDailyUsage);
      const status = classifyStockStatus({
        daysOfCover: cover,
        leadTimeDays
      });
      return {
        sku,
        title: ((_g = node.variant) == null ? void 0 : _g.displayName) ?? sku,
        currentStock: available,
        avgDailyUsage,
        daysOfCover: cover,
        reorderPoint,
        status,
        leadTimeDays,
        daysOfDataCollected: history.filter((h) => h > 0).length
      };
    })
  );
}
const statusBadge = {
  reorder_now: /* @__PURE__ */ jsx(Badge, { tone: "critical", children: "Reorder now" }),
  reorder_soon: /* @__PURE__ */ jsx(Badge, { tone: "warning", children: "Reorder soon" }),
  healthy: /* @__PURE__ */ jsx(Badge, { tone: "success", children: "Healthy" }),
  no_recent_sales: /* @__PURE__ */ jsx(Badge, { children: "No recent sales" })
};
function Dashboard() {
  var _a2, _b, _c;
  const { forecastSnapshot } = useLoaderData();
  const [question, setQuestion] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  const [clickCount, setClickCount] = useState(0);
  const fetcher = useFetcher();
  const handleAsk = () => {
    setClickCount((c) => c + 1);
    fetcher.submit(
      { question, snapshot: JSON.stringify(forecastSnapshot) },
      { method: "post", action: "/api/agent-chat" }
    );
  };
  useEffect(() => {
    var _a3;
    if ((_a3 = fetcher.data) == null ? void 0 : _a3.error) {
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
    statusBadge[item.status]
  ]);
  return /* @__PURE__ */ jsxs(Frame, { children: [
    /* @__PURE__ */ jsx(Page, { title: "Inventory Forecast Agent", children: /* @__PURE__ */ jsxs(Layout, { children: [
      /* @__PURE__ */ jsx(Layout.Section, { children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
        DataTable,
        {
          columnContentTypes: [
            "text",
            "text",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
            "text"
          ],
          headings: [
            "SKU",
            "Product",
            "In stock",
            "Avg daily usage",
            "Days of cover",
            "Reorder point",
            "Status"
          ],
          rows
        }
      ) }) }),
      /* @__PURE__ */ jsx(Layout.Section, { variant: "oneThird", children: /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: "Ask the forecast agent" }),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: "Question",
            labelHidden: true,
            value: question,
            onChange: setQuestion,
            placeholder: "What should I reorder before next week?",
            autoComplete: "off",
            multiline: 2
          }
        ),
        /* @__PURE__ */ jsx(Button, { onClick: handleAsk, loading: fetcher.state !== "idle", children: "Ask" }),
        /* @__PURE__ */ jsxs(Text, { as: "p", tone: "subdued", children: [
          "debug: clicks=",
          clickCount,
          " fetcherState=",
          fetcher.state,
          " ",
          "hasAnswer=",
          String(!!((_a2 = fetcher.data) == null ? void 0 : _a2.answer)),
          " hasError=",
          String(!!((_b = fetcher.data) == null ? void 0 : _b.error))
        ] }),
        ((_c = fetcher.data) == null ? void 0 : _c.answer) && /* @__PURE__ */ jsx(Text, { as: "p", children: fetcher.data.answer })
      ] }) }) })
    ] }) }),
    toastMessage && /* @__PURE__ */ jsx(
      Toast,
      {
        content: toastMessage,
        error: true,
        onDismiss: () => setToastMessage(null)
      }
    )
  ] });
}
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Dashboard,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
const loader$2 = async ({ request }) => {
  return await authenticate.admin(request);
};
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
const loader$1 = async ({ request }) => {
  const url = new URL(request.url);
  throw redirect(`/app?${url.searchParams.toString()}`);
};
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};
function AppLayout() {
  return /* @__PURE__ */ jsx(Outlet, {});
}
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: AppLayout,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-CoqfdK3G.js", "imports": ["/assets/index-ChlofgUW.js", "/assets/components-BLMfUpc_.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": true, "module": "/assets/root-BBhmnM6d.js", "imports": ["/assets/index-ChlofgUW.js", "/assets/components-BLMfUpc_.js", "/assets/context-BhOjLyMq.js"], "css": ["/assets/root-C7YjYK5e.css"] }, "routes/webhooks.orders-updated": { "id": "routes/webhooks.orders-updated", "parentId": "root", "path": "webhooks/orders-updated", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/webhooks.orders-updated-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/api.agent-chat": { "id": "routes/api.agent-chat", "parentId": "root", "path": "api/agent-chat", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/api.agent-chat-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/auth.callback": { "id": "routes/auth.callback", "parentId": "root", "path": "auth/callback", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/auth.callback-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/app._index": { "id": "routes/app._index", "parentId": "routes/app", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app._index-Bk_qzBaM.js", "imports": ["/assets/index-ChlofgUW.js", "/assets/components-BLMfUpc_.js", "/assets/context-BhOjLyMq.js"], "css": [] }, "routes/auth.login": { "id": "routes/auth.login", "parentId": "root", "path": "auth/login", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/auth.login-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/_index": { "id": "routes/_index", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/_index-l0sNRNKZ.js", "imports": [], "css": [] }, "routes/app": { "id": "routes/app", "parentId": "root", "path": "app", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasErrorBoundary": false, "module": "/assets/app-3pnD0jKU.js", "imports": ["/assets/index-ChlofgUW.js"], "css": [] } }, "url": "/assets/manifest-f0d1b676.js", "version": "f0d1b676" };
const mode = "production";
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "v3_fetcherPersist": false, "v3_relativeSplatPath": false, "v3_throwAbortReason": false, "v3_routeConfig": false, "v3_singleFetch": false, "v3_lazyRouteDiscovery": false, "unstable_optimizeDeps": false };
const isSpaMode = false;
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/webhooks.orders-updated": {
    id: "routes/webhooks.orders-updated",
    parentId: "root",
    path: "webhooks/orders-updated",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/api.agent-chat": {
    id: "routes/api.agent-chat",
    parentId: "root",
    path: "api/agent-chat",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/auth.callback": {
    id: "routes/auth.callback",
    parentId: "root",
    path: "auth/callback",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/app._index": {
    id: "routes/app._index",
    parentId: "routes/app",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route4
  },
  "routes/auth.login": {
    id: "routes/auth.login",
    parentId: "root",
    path: "auth/login",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route6
  },
  "routes/app": {
    id: "routes/app",
    parentId: "root",
    path: "app",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  }
};
export {
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  mode,
  publicPath,
  routes
};
