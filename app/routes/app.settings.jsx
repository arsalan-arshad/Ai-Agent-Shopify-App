import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  DataTable,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../lib/shopify.server.js";
import {
  getShopAiSettings,
  saveShopAiSettings,
  getUsageSummary,
} from "../lib/ai-settings.server.js";
import { listLeadTimeSettings, setLeadTimeDays } from "../lib/usage-history.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [aiSettings, usage, leadTimes] = await Promise.all([
    getShopAiSettings(shop),
    getUsageSummary(shop),
    listLeadTimeSettings(shop),
  ]);

  return json({ aiSettings, usage, leadTimes });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");

  try {
    if (intent === "saveAiSettings") {
      const provider = formData.get("provider");
      const apiKey = formData.get("apiKey");
      await saveShopAiSettings(shop, provider, apiKey);
      return json({ ok: true, intent });
    }

    if (intent === "saveLeadTime") {
      const skuRaw = formData.get("sku")?.toString().trim();
      const sku = skuRaw ? skuRaw : null;
      const leadTimeDays = parseInt(formData.get("leadTimeDays"), 10);
      const supplierName = formData.get("supplierName")?.toString().trim() || null;

      if (!Number.isFinite(leadTimeDays) || leadTimeDays <= 0) {
        return json({ ok: false, intent, error: "Lead time must be a positive number of days." }, { status: 400 });
      }

      await setLeadTimeDays(shop, sku, leadTimeDays, supplierName);
      return json({ ok: true, intent });
    }

    return json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("Settings action failed:", err);
    return json({ ok: false, intent, error: err.message ?? "Something went wrong." }, { status: 400 });
  }
};

const PROVIDER_OPTIONS = [
  { label: "Google Gemini", value: "gemini" },
  { label: "Anthropic Claude", value: "claude" },
];

function money(n) {
  return `$${(n ?? 0).toFixed(4)}`;
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
  // own specific error message. Return it so callers show that message
  // instead of a generic one that throws away the real reason.
  return data;
}

export default function Settings() {
  const { aiSettings, usage, leadTimes } = useLoaderData();

  const [provider, setProvider] = useState(aiSettings?.provider ?? "gemini");
  const [apiKey, setApiKey] = useState("");
  const [sku, setSku] = useState("");
  const [leadTimeDays, setLeadTimeDaysInput] = useState("14");
  const [supplierName, setSupplierName] = useState("");

  const [aiSaving, setAiSaving] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [leadTimeSaving, setLeadTimeSaving] = useState(false);
  const [leadTimeResult, setLeadTimeResult] = useState(null);

  const handleSaveAiSettings = async (event) => {
    event.preventDefault();
    if (aiSaving) return;
    setAiSaving(true);
    setAiResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveAiSettings");
      fd.set("provider", provider);
      fd.set("apiKey", apiKey);
      const data = await postWithSessionToken("/app/settings", fd);
      setAiResult(data);
      if (data?.ok) setApiKey("");
    } catch (err) {
      console.error("Save AI settings failed:", err);
      setAiResult({ ok: false, intent: "saveAiSettings", error: err.message || "Couldn't save — please try again." });
    } finally {
      setAiSaving(false);
    }
  };

  const handleSaveLeadTime = async (event) => {
    event.preventDefault();
    if (leadTimeSaving) return;
    setLeadTimeSaving(true);
    setLeadTimeResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveLeadTime");
      fd.set("sku", sku);
      fd.set("leadTimeDays", leadTimeDays);
      fd.set("supplierName", supplierName);
      const data = await postWithSessionToken("/app/settings", fd);
      setLeadTimeResult(data);
      if (data?.ok) {
        setSku("");
        setSupplierName("");
      }
    } catch (err) {
      console.error("Save lead time failed:", err);
      setLeadTimeResult({ ok: false, intent: "saveLeadTime", error: err.message || "Couldn't save — please try again." });
    } finally {
      setLeadTimeSaving(false);
    }
  };

  const leadTimeRows = leadTimes.map((lt) => [
    lt.sku ?? <Badge>Shop default</Badge>,
    lt.supplierName ?? "—",
    `${lt.leadTimeDays} days`,
  ]);

  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                AI provider
              </Text>
              <Text as="p" tone="subdued">
                The forecast table and reorder math work without this — they're
                computed deterministically, not by AI. This key only powers the
                chat panel that explains the numbers. We never see or store
                your key in plain text, and there's no shared/trial key: until
                you add your own, chat stays off.
              </Text>

              {aiSettings ? (
                <Banner tone="success">
                  <p>
                    Currently using <strong>{aiSettings.provider === "claude" ? "Anthropic Claude" : "Google Gemini"}</strong>{" "}
                    with a key ending in <strong>•••{aiSettings.apiKeyLast4}</strong>. Save a new
                    key below to replace it.
                  </p>
                </Banner>
              ) : (
                <Banner tone="warning">
                  <p>No AI key configured yet — the chat panel will prompt merchants to come here.</p>
                </Banner>
              )}

              {aiResult?.ok && aiResult.intent === "saveAiSettings" && (
                <Banner tone="success">Saved.</Banner>
              )}
              {aiResult?.ok === false && aiResult.intent === "saveAiSettings" && (
                <Banner tone="critical">{aiResult.error}</Banner>
              )}

              <form onSubmit={handleSaveAiSettings}>
                <FormLayout>
                  <Select
                    label="Provider"
                    name="provider"
                    options={PROVIDER_OPTIONS}
                    value={provider}
                    onChange={setProvider}
                  />
                  <TextField
                    label="API key"
                    name="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={setApiKey}
                    autoComplete="off"
                    helpText={
                      provider === "claude"
                        ? "From console.anthropic.com — starts with sk-ant-"
                        : "From aistudio.google.com/apikey"
                    }
                  />
                  <Button submit variant="primary" loading={aiSaving}>
                    Save
                  </Button>
                </FormLayout>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                AI usage (this key)
              </Text>
              <InlineStack gap="400">
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">
                    Last 30 days
                  </Text>
                  <Text as="p">{usage.last30d.requests} questions</Text>
                  <Text as="p">
                    {usage.last30d.inputTokens + usage.last30d.outputTokens} tokens
                  </Text>
                  <Text as="p">~{money(usage.last30d.estimatedCostUsd)} estimated</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued">
                    All time
                  </Text>
                  <Text as="p">{usage.allTime.requests} questions</Text>
                  <Text as="p">
                    {usage.allTime.inputTokens + usage.allTime.outputTokens} tokens
                  </Text>
                  <Text as="p">~{money(usage.allTime.estimatedCostUsd)} estimated</Text>
                </BlockStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                Estimated cost is a rough guide based on public provider pricing — you're
                billed by Gemini or Claude directly on your own account, not by us.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Lead times
              </Text>
              <Text as="p" tone="subdued">
                How many days it takes a reorder to arrive. Set a shop-wide default
                and override it per SKU where suppliers differ.
              </Text>

              {leadTimeRows.length > 0 && (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["SKU", "Supplier", "Lead time"]}
                  rows={leadTimeRows}
                />
              )}

              {leadTimeResult?.ok === false && leadTimeResult.intent === "saveLeadTime" && (
                <Banner tone="critical">{leadTimeResult.error}</Banner>
              )}

              <form onSubmit={handleSaveLeadTime}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="SKU (leave blank for shop default)"
                      name="sku"
                      value={sku}
                      onChange={setSku}
                      autoComplete="off"
                    />
                    <TextField
                      label="Lead time (days)"
                      name="leadTimeDays"
                      type="number"
                      min={1}
                      value={leadTimeDays}
                      onChange={setLeadTimeDaysInput}
                      autoComplete="off"
                    />
                    <TextField
                      label="Supplier (optional)"
                      name="supplierName"
                      value={supplierName}
                      onChange={setSupplierName}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <Button submit loading={leadTimeSaving}>
                    Save lead time
                  </Button>
                </FormLayout>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
