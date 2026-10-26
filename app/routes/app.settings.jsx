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
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../lib/shopify.server.js";
import {
  getShopAiSettings,
  saveShopAiSettings,
  getUsageSummary,
} from "../lib/ai-settings.server.js";
import { listLeadTimeSettings, setLeadTimeDays } from "../lib/usage-history.server.js";
import { getMarketingOptIn, setMarketingOptIn, saveFeedback } from "../lib/merchant.server.js";
import {
  getPreorderSetting,
  setPreorderSetting,
  listRestockDates,
  setRestockDate,
  deleteRestockDate,
} from "../lib/preorder-settings.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [aiSettings, usage, leadTimes, marketingOptIn, preorderSetting, restockDates] =
    await Promise.all([
      getShopAiSettings(shop),
      getUsageSummary(shop),
      listLeadTimeSettings(shop),
      getMarketingOptIn(shop),
      getPreorderSetting(shop),
      listRestockDates(shop),
    ]);

  return json({
    aiSettings,
    usage,
    leadTimes,
    marketingOptIn,
    preorderSetting,
    restockDates: restockDates.map((r) => ({
      sku: r.sku,
      date: r.date.toISOString().slice(0, 10),
      qty: r.qty,
    })),
  });
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

    if (intent === "saveContactPrefs") {
      const optIn = formData.get("marketingOptIn") === "true";
      await setMarketingOptIn(shop, optIn);
      return json({ ok: true, intent, marketingOptIn: optIn });
    }

    if (intent === "submitFeedback") {
      const rating = parseInt(formData.get("rating"), 10);
      const message = formData.get("message")?.toString() ?? "";
      await saveFeedback(shop, rating, message);
      return json({ ok: true, intent });
    }

    if (intent === "savePreorderSetting") {
      const switchOnCoverDays = parseInt(formData.get("switchOnCoverDays"), 10);
      const switchOffCoverDays = parseInt(formData.get("switchOffCoverDays"), 10);
      await setPreorderSetting(shop, switchOnCoverDays, switchOffCoverDays);
      return json({ ok: true, intent });
    }

    if (intent === "saveRestockDate") {
      const sku = formData.get("sku")?.toString().trim();
      const date = formData.get("date")?.toString().trim();
      const qtyRaw = formData.get("qty")?.toString().trim();
      const qty = qtyRaw ? qtyRaw : null;
      await setRestockDate(shop, sku, date, qty);
      return json({ ok: true, intent });
    }

    if (intent === "deleteRestockDate") {
      const sku = formData.get("sku")?.toString().trim();
      await deleteRestockDate(shop, sku);
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

// A plain fetch POST to a UI route makes Remix render the whole HTML page
// after the action; `_data` asks for just the action's JSON.
const SETTINGS_ACTION_URL = "/app/settings?_data=routes%2Fapp.settings";

const RATING_OPTIONS = [
  { label: "Choose a rating", value: "" },
  { label: "5 — Excellent", value: "5" },
  { label: "4 — Good", value: "4" },
  { label: "3 — Okay", value: "3" },
  { label: "2 — Poor", value: "2" },
  { label: "1 — Very poor", value: "1" },
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
  const {
    aiSettings,
    usage,
    leadTimes,
    marketingOptIn,
    preorderSetting,
    restockDates,
  } = useLoaderData();

  const [provider, setProvider] = useState(aiSettings?.provider ?? "gemini");
  const [apiKey, setApiKey] = useState("");
  const [sku, setSku] = useState("");
  const [leadTimeDays, setLeadTimeDaysInput] = useState("14");
  const [supplierName, setSupplierName] = useState("");

  const [aiSaving, setAiSaving] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [leadTimeSaving, setLeadTimeSaving] = useState(false);
  const [leadTimeResult, setLeadTimeResult] = useState(null);

  const [switchOnCoverDays, setSwitchOnCoverDays] = useState(
    String(preorderSetting?.switchOnCoverDays ?? 3),
  );
  const [switchOffCoverDays, setSwitchOffCoverDays] = useState(
    String(preorderSetting?.switchOffCoverDays ?? 7),
  );
  const [preorderSaving, setPreorderSaving] = useState(false);
  const [preorderResult, setPreorderResult] = useState(null);

  const [restockSku, setRestockSku] = useState("");
  const [restockDate, setRestockDateInput] = useState("");
  const [restockQty, setRestockQty] = useState("");
  const [restockSaving, setRestockSaving] = useState(false);
  const [restockResult, setRestockResult] = useState(null);
  const [restockDeletingSku, setRestockDeletingSku] = useState(null);

  const [optIn, setOptIn] = useState(marketingOptIn);
  const [optInSaving, setOptInSaving] = useState(false);
  const [optInResult, setOptInResult] = useState(null);
  const [rating, setRating] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState(null);

  const handleOptInChange = async (checked) => {
    if (optInSaving) return;
    const previous = optIn;
    setOptIn(checked);
    setOptInSaving(true);
    setOptInResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveContactPrefs");
      fd.set("marketingOptIn", String(checked));
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      if (!data?.ok) setOptIn(previous);
      setOptInResult(data);
    } catch (err) {
      console.error("Save contact preference failed:", err);
      setOptIn(previous);
      setOptInResult({ ok: false, error: err.message || "Couldn't save — please try again." });
    } finally {
      setOptInSaving(false);
    }
  };

  const handleSubmitFeedback = async (event) => {
    event.preventDefault();
    if (feedbackSending) return;
    setFeedbackSending(true);
    setFeedbackResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "submitFeedback");
      fd.set("rating", rating);
      fd.set("message", feedbackMessage);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setFeedbackResult(data);
      if (data?.ok) {
        setRating("");
        setFeedbackMessage("");
      }
    } catch (err) {
      console.error("Submit feedback failed:", err);
      setFeedbackResult({ ok: false, error: err.message || "Couldn't send — please try again." });
    } finally {
      setFeedbackSending(false);
    }
  };

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
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
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
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
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

  const handleSavePreorderSetting = async (event) => {
    event.preventDefault();
    if (preorderSaving) return;
    setPreorderSaving(true);
    setPreorderResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "savePreorderSetting");
      fd.set("switchOnCoverDays", switchOnCoverDays);
      fd.set("switchOffCoverDays", switchOffCoverDays);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setPreorderResult(data);
    } catch (err) {
      console.error("Save pre-order defaults failed:", err);
      setPreorderResult({
        ok: false,
        intent: "savePreorderSetting",
        error: err.message || "Couldn't save — please try again.",
      });
    } finally {
      setPreorderSaving(false);
    }
  };

  const handleSaveRestockDate = async (event) => {
    event.preventDefault();
    if (restockSaving) return;
    setRestockSaving(true);
    setRestockResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveRestockDate");
      fd.set("sku", restockSku);
      fd.set("date", restockDate);
      fd.set("qty", restockQty);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setRestockResult(data);
      if (data?.ok) {
        setRestockSku("");
        setRestockDateInput("");
        setRestockQty("");
        // Reload so the table reflects the upsert without a full navigation dance.
        window.location.reload();
      }
    } catch (err) {
      console.error("Save restock date failed:", err);
      setRestockResult({
        ok: false,
        intent: "saveRestockDate",
        error: err.message || "Couldn't save — please try again.",
      });
    } finally {
      setRestockSaving(false);
    }
  };

  const handleDeleteRestockDate = async (skuToDelete) => {
    if (restockDeletingSku) return;
    setRestockDeletingSku(skuToDelete);
    setRestockResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "deleteRestockDate");
      fd.set("sku", skuToDelete);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setRestockResult(data);
      if (data?.ok) window.location.reload();
    } catch (err) {
      console.error("Delete restock date failed:", err);
      setRestockResult({
        ok: false,
        intent: "deleteRestockDate",
        error: err.message || "Couldn't clear — please try again.",
      });
    } finally {
      setRestockDeletingSku(null);
    }
  };

  const leadTimeRows = leadTimes.map((lt) => [
    // sku is "" (not null) for the shop-wide default row -- see
    // usage-history.server.js#setLeadTimeDays -- so this must be a
    // truthiness check, not ?? (which only catches null/undefined).
    lt.sku ? lt.sku : <Badge>Shop default</Badge>,
    lt.supplierName ?? "—",
    `${lt.leadTimeDays} days`,
  ]);

  const restockRows = restockDates.map((r) => [
    r.sku,
    r.date,
    r.qty == null ? "—" : String(r.qty),
    <Button
      key={`clear-${r.sku}`}
      tone="critical"
      variant="plain"
      loading={restockDeletingSku === r.sku}
      onClick={() => handleDeleteRestockDate(r.sku)}
    >
      Clear
    </Button>,
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

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Pre-order recommendation defaults
              </Text>
              <Text as="p" tone="subdued">
                Recommend switching a SKU to pre-order when cover falls to the
                switch-on threshold, and switching back once cover recovers past
                the switch-off threshold. Switch-off must stay higher than
                switch-on so products never flap. Recommend-only — this app does
                not change your catalog.
              </Text>

              {preorderResult?.ok && preorderResult.intent === "savePreorderSetting" && (
                <Banner tone="success">Saved.</Banner>
              )}
              {preorderResult?.ok === false && preorderResult.intent === "savePreorderSetting" && (
                <Banner tone="critical">{preorderResult.error}</Banner>
              )}

              <form onSubmit={handleSavePreorderSetting}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Switch-on cover days"
                      name="switchOnCoverDays"
                      type="number"
                      min={0}
                      value={switchOnCoverDays}
                      onChange={setSwitchOnCoverDays}
                      autoComplete="off"
                      helpText="Default 3 — suggest pre-order when this many days of cover remain."
                    />
                    <TextField
                      label="Switch-off cover days"
                      name="switchOffCoverDays"
                      type="number"
                      min={0}
                      value={switchOffCoverDays}
                      onChange={setSwitchOffCoverDays}
                      autoComplete="off"
                      helpText="Default 7 — suggest switching back once cover recovers past this."
                    />
                  </FormLayout.Group>
                  <Button submit loading={preorderSaving}>
                    Save defaults
                  </Button>
                </FormLayout>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Restock dates
              </Text>
              <Text as="p" tone="subdued">
                Expected arrival per SKU. The dashboard uses these with your
                forecast to show a gap recommendation when restock lands after
                stockout. Leave blank and the app behaves exactly as before.
              </Text>

              {restockRows.length > 0 && (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text"]}
                  headings={["SKU", "Restock date", "Expected qty", ""]}
                  rows={restockRows}
                />
              )}

              {restockResult?.ok === false &&
                (restockResult.intent === "saveRestockDate" ||
                  restockResult.intent === "deleteRestockDate") && (
                  <Banner tone="critical">{restockResult.error}</Banner>
                )}

              <form onSubmit={handleSaveRestockDate}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="SKU"
                      name="sku"
                      value={restockSku}
                      onChange={setRestockSku}
                      autoComplete="off"
                    />
                    <TextField
                      label="Restock date"
                      name="date"
                      type="date"
                      value={restockDate}
                      onChange={setRestockDateInput}
                      autoComplete="off"
                    />
                    <TextField
                      label="Expected qty (optional)"
                      name="qty"
                      type="number"
                      min={0}
                      value={restockQty}
                      onChange={setRestockQty}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <Button submit loading={restockSaving}>
                    Save restock date
                  </Button>
                </FormLayout>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Contact &amp; feedback
              </Text>

              <Checkbox
                label="OK to contact me for feedback or about custom Shopify work."
                helpText="We only use your store email for support unless you tick this. You can untick it any time."
                checked={optIn}
                onChange={handleOptInChange}
                disabled={optInSaving}
              />
              {optInResult?.ok && (
                <Text as="p" tone="success">
                  {optInResult.marketingOptIn ? "Thanks — you're opted in." : "Opted out."}
                </Text>
              )}
              {optInResult?.ok === false && <Banner tone="critical">{optInResult.error}</Banner>}

              <form onSubmit={handleSubmitFeedback}>
                <FormLayout>
                  <Select
                    label="How is the app working for you?"
                    name="rating"
                    options={RATING_OPTIONS}
                    value={rating}
                    onChange={setRating}
                  />
                  <TextField
                    label="Comment (optional)"
                    name="message"
                    value={feedbackMessage}
                    onChange={setFeedbackMessage}
                    multiline={3}
                    maxLength={2000}
                    showCharacterCount
                    autoComplete="off"
                  />
                  {feedbackResult?.ok && <Banner tone="success">Thanks for the feedback!</Banner>}
                  {feedbackResult?.ok === false && (
                    <Banner tone="critical">{feedbackResult.error}</Banner>
                  )}
                  <Button submit loading={feedbackSending} disabled={!rating}>
                    Send feedback
                  </Button>
                </FormLayout>
              </form>

              <Text as="p" tone="subdued">
                Need custom Shopify work? Email arsalanarshad.dev@gmail.com
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
