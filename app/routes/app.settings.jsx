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
import { daysUntilRestock, isRestockDateStale } from "../lib/preorder.js";
import {
  getReorderSetting,
  setReorderSetting,
  listSuppliers,
  createSupplier,
  deleteSupplier,
  listSkuSupplierTerms,
  setSkuSupplierTerms,
  deleteSkuSupplierTerms,
  importSkuSupplierTermsCsv,
} from "../lib/reorder-settings.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [
    aiSettings,
    usage,
    leadTimes,
    marketingOptIn,
    preorderSetting,
    restockDates,
    reorderSetting,
    suppliers,
    skuTerms,
  ] = await Promise.all([
    getShopAiSettings(shop),
    getUsageSummary(shop),
    listLeadTimeSettings(shop),
    getMarketingOptIn(shop),
    getPreorderSetting(shop),
    listRestockDates(shop),
    getReorderSetting(shop),
    listSuppliers(shop),
    listSkuSupplierTerms(shop),
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
    reorderSetting,
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      defaultLeadTimeDays: s.defaultLeadTimeDays,
      notes: s.notes,
    })),
    skuTerms: skuTerms.map((t) => ({
      sku: t.sku,
      supplierId: t.supplierId,
      supplierName: t.supplier?.name ?? "—",
      leadTimeDays: t.leadTimeDays,
      moq: t.moq,
      packSize: t.packSize,
      unitCost: t.unitCost,
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
      const switchOnCoverDays = formData.get("switchOnCoverDays")?.toString();
      const switchOffCoverDays = formData.get("switchOffCoverDays")?.toString();
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

    if (intent === "saveReorderSetting") {
      const reviewDays = formData.get("reviewDays")?.toString();
      const serviceLevelZ = formData.get("serviceLevelZ")?.toString();
      await setReorderSetting(shop, reviewDays, serviceLevelZ);
      return json({ ok: true, intent });
    }

    if (intent === "createSupplier") {
      const name = formData.get("name")?.toString();
      const defaultLeadTimeDays = formData.get("defaultLeadTimeDays")?.toString();
      const notes = formData.get("notes")?.toString();
      await createSupplier(shop, name, defaultLeadTimeDays, notes);
      return json({ ok: true, intent });
    }

    if (intent === "deleteSupplier") {
      const id = formData.get("id")?.toString();
      await deleteSupplier(shop, id);
      return json({ ok: true, intent });
    }

    if (intent === "saveSkuTerms") {
      await setSkuSupplierTerms(shop, {
        sku: formData.get("sku")?.toString(),
        supplierId: formData.get("supplierId")?.toString(),
        leadTimeDays: formData.get("leadTimeDays")?.toString(),
        moq: formData.get("moq")?.toString(),
        packSize: formData.get("packSize")?.toString(),
        unitCost: formData.get("unitCost")?.toString(),
      });
      return json({ ok: true, intent });
    }

    if (intent === "deleteSkuTerms") {
      const sku = formData.get("sku")?.toString();
      await deleteSkuSupplierTerms(shop, sku);
      return json({ ok: true, intent });
    }

    if (intent === "importSkuTermsCsv") {
      const csvText = formData.get("csvText")?.toString() ?? "";
      const result = await importSkuSupplierTermsCsv(shop, csvText);
      if (result.ok === 0 && result.errors.length > 0) {
        return json(
          {
            ok: false,
            intent,
            error: result.errors.slice(0, 5).join(" "),
            importResult: result,
          },
          { status: 400 },
        );
      }
      return json({ ok: true, intent, importResult: result });
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
    reorderSetting,
    suppliers,
    skuTerms,
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

  const [reviewDays, setReviewDays] = useState(
    String(reorderSetting?.reviewDays ?? 14),
  );
  const [serviceLevelZ, setServiceLevelZ] = useState(
    String(reorderSetting?.serviceLevelZ ?? 1.65),
  );
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderResult, setReorderResult] = useState(null);

  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierLead, setNewSupplierLead] = useState("14");
  const [newSupplierNotes, setNewSupplierNotes] = useState("");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierResult, setSupplierResult] = useState(null);
  const [supplierDeletingId, setSupplierDeletingId] = useState(null);

  const [termsSku, setTermsSku] = useState("");
  const [termsSupplierId, setTermsSupplierId] = useState(
    suppliers?.[0] ? String(suppliers[0].id) : "",
  );
  const [termsLead, setTermsLead] = useState("");
  const [termsMoq, setTermsMoq] = useState("");
  const [termsPack, setTermsPack] = useState("");
  const [termsCost, setTermsCost] = useState("");
  const [termsSaving, setTermsSaving] = useState(false);
  const [termsResult, setTermsResult] = useState(null);
  const [termsDeletingSku, setTermsDeletingSku] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [csvSaving, setCsvSaving] = useState(false);

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

  const handleSaveReorderSetting = async (event) => {
    event.preventDefault();
    if (reorderSaving) return;
    setReorderSaving(true);
    setReorderResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveReorderSetting");
      fd.set("reviewDays", reviewDays);
      fd.set("serviceLevelZ", serviceLevelZ);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setReorderResult(data);
    } catch (err) {
      console.error("Save reorder defaults failed:", err);
      setReorderResult({
        ok: false,
        intent: "saveReorderSetting",
        error: err.message || "Couldn't save — please try again.",
      });
    } finally {
      setReorderSaving(false);
    }
  };

  const handleCreateSupplier = async (event) => {
    event.preventDefault();
    if (supplierSaving) return;
    setSupplierSaving(true);
    setSupplierResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "createSupplier");
      fd.set("name", newSupplierName);
      fd.set("defaultLeadTimeDays", newSupplierLead);
      fd.set("notes", newSupplierNotes);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setSupplierResult(data);
      if (data?.ok) {
        setNewSupplierName("");
        setNewSupplierNotes("");
        window.location.reload();
      }
    } catch (err) {
      console.error("Create supplier failed:", err);
      setSupplierResult({
        ok: false,
        intent: "createSupplier",
        error: err.message || "Couldn't save — please try again.",
      });
    } finally {
      setSupplierSaving(false);
    }
  };

  const handleDeleteSupplier = async (id) => {
    if (supplierDeletingId) return;
    setSupplierDeletingId(id);
    setSupplierResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "deleteSupplier");
      fd.set("id", String(id));
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setSupplierResult(data);
      if (data?.ok) window.location.reload();
    } catch (err) {
      console.error("Delete supplier failed:", err);
      setSupplierResult({
        ok: false,
        intent: "deleteSupplier",
        error: err.message || "Couldn't delete — please try again.",
      });
    } finally {
      setSupplierDeletingId(null);
    }
  };

  const handleSaveSkuTerms = async (event) => {
    event.preventDefault();
    if (termsSaving) return;
    setTermsSaving(true);
    setTermsResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "saveSkuTerms");
      fd.set("sku", termsSku);
      fd.set("supplierId", termsSupplierId);
      fd.set("leadTimeDays", termsLead);
      fd.set("moq", termsMoq);
      fd.set("packSize", termsPack);
      fd.set("unitCost", termsCost);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setTermsResult(data);
      if (data?.ok) {
        setTermsSku("");
        setTermsLead("");
        setTermsMoq("");
        setTermsPack("");
        setTermsCost("");
        window.location.reload();
      }
    } catch (err) {
      console.error("Save SKU terms failed:", err);
      setTermsResult({
        ok: false,
        intent: "saveSkuTerms",
        error: err.message || "Couldn't save — please try again.",
      });
    } finally {
      setTermsSaving(false);
    }
  };

  const handleDeleteSkuTerms = async (skuToDelete) => {
    if (termsDeletingSku) return;
    setTermsDeletingSku(skuToDelete);
    setTermsResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "deleteSkuTerms");
      fd.set("sku", skuToDelete);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setTermsResult(data);
      if (data?.ok) window.location.reload();
    } catch (err) {
      console.error("Delete SKU terms failed:", err);
      setTermsResult({
        ok: false,
        intent: "deleteSkuTerms",
        error: err.message || "Couldn't clear — please try again.",
      });
    } finally {
      setTermsDeletingSku(null);
    }
  };

  const handleImportCsv = async (event) => {
    event.preventDefault();
    if (csvSaving) return;
    setCsvSaving(true);
    setTermsResult(null);
    try {
      const fd = new FormData();
      fd.set("_action", "importSkuTermsCsv");
      fd.set("csvText", csvText);
      const data = await postWithSessionToken(SETTINGS_ACTION_URL, fd);
      setTermsResult(data);
      if (data?.ok) {
        setCsvText("");
        window.location.reload();
      }
    } catch (err) {
      console.error("Import SKU terms CSV failed:", err);
      setTermsResult({
        ok: false,
        intent: "importSkuTermsCsv",
        error: err.message || "Couldn't import — please try again.",
      });
    } finally {
      setCsvSaving(false);
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

  const staleRestockDates = restockDates.filter((r) =>
    isRestockDateStale(daysUntilRestock(r.date)),
  );

  const restockRows = restockDates.map((r) => {
    const stale = isRestockDateStale(daysUntilRestock(r.date));
    return [
      r.sku,
      stale ? (
        <InlineStack key={`date-${r.sku}`} gap="200" blockAlign="center" wrap>
          <span>{r.date}</span>
          <Badge tone="warning">Past date</Badge>
        </InlineStack>
      ) : (
        r.date
      ),
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
    ];
  });

  const supplierRows = (suppliers ?? []).map((s) => [
    s.name,
    `${s.defaultLeadTimeDays} days`,
    s.notes ?? "—",
    <Button
      key={`del-sup-${s.id}`}
      tone="critical"
      variant="plain"
      loading={supplierDeletingId === s.id}
      onClick={() => handleDeleteSupplier(s.id)}
    >
      Delete
    </Button>,
  ]);

  const termsRows = (skuTerms ?? []).map((t) => [
    t.sku,
    t.supplierName,
    t.leadTimeDays == null ? "—" : `${t.leadTimeDays}d`,
    t.moq == null ? "—" : String(t.moq),
    t.packSize == null ? "—" : String(t.packSize),
    t.unitCost == null ? "—" : `$${Number(t.unitCost).toFixed(2)}`,
    <Button
      key={`del-terms-${t.sku}`}
      tone="critical"
      variant="plain"
      loading={termsDeletingSku === t.sku}
      onClick={() => handleDeleteSkuTerms(t.sku)}
    >
      Clear
    </Button>,
  ]);

  const supplierOptions = [
    { label: suppliers?.length ? "Select supplier" : "Add a supplier first", value: "" },
    ...(suppliers ?? []).map((s) => ({
      label: s.name,
      value: String(s.id),
    })),
  ];

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

              {staleRestockDates.length > 0 && (
                <Banner tone="warning" title="Restock dates in the past">
                  <p>
                    {staleRestockDates.map((r) => r.sku).join(", ")} — update
                    the expected arrival so recommendations stay accurate.
                  </p>
                </Banner>
              )}

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
                      helpText="Must match your catalog SKU exactly (case-sensitive)."
                    />
                    <TextField
                      label="Restock date"
                      name="date"
                      type="date"
                      value={restockDate}
                      onChange={setRestockDateInput}
                      autoComplete="off"
                      helpText="Dates are interpreted in UTC."
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
                Reorder defaults
              </Text>
              <Text as="p" tone="subdued">
                Review period and service-level z feed the order-up-to formula
                (lead time + review + safety stock). Defaults are 14 days and
                z = 1.65 (~95% service level). Recommend-only — no orders are
                placed.
              </Text>

              {reorderResult?.ok && reorderResult.intent === "saveReorderSetting" && (
                <Banner tone="success">Saved.</Banner>
              )}
              {reorderResult?.ok === false &&
                reorderResult.intent === "saveReorderSetting" && (
                  <Banner tone="critical">{reorderResult.error}</Banner>
                )}

              <form onSubmit={handleSaveReorderSetting}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Review period (days)"
                      name="reviewDays"
                      type="number"
                      min={1}
                      value={reviewDays}
                      onChange={setReviewDays}
                      autoComplete="off"
                      helpText="How often you place replenishment orders."
                    />
                    <TextField
                      label="Service-level z"
                      name="serviceLevelZ"
                      value={serviceLevelZ}
                      onChange={setServiceLevelZ}
                      autoComplete="off"
                      helpText="1.65 ≈ 95% service level. Safety stock scales with this."
                    />
                  </FormLayout.Group>
                  <Button submit loading={reorderSaving}>
                    Save reorder defaults
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
                Suppliers
              </Text>
              <Text as="p" tone="subdued">
                Merchant-entered suppliers stored in this app only — not written
                to Shopify. Used to group draft purchase orders.
              </Text>

              {supplierRows.length > 0 && (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Name", "Default lead time", "Notes", ""]}
                  rows={supplierRows}
                />
              )}

              {supplierResult?.ok === false &&
                (supplierResult.intent === "createSupplier" ||
                  supplierResult.intent === "deleteSupplier") && (
                  <Banner tone="critical">{supplierResult.error}</Banner>
                )}

              <form onSubmit={handleCreateSupplier}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Supplier name"
                      name="name"
                      value={newSupplierName}
                      onChange={setNewSupplierName}
                      autoComplete="off"
                    />
                    <TextField
                      label="Default lead time (days)"
                      name="defaultLeadTimeDays"
                      type="number"
                      min={1}
                      value={newSupplierLead}
                      onChange={setNewSupplierLead}
                      autoComplete="off"
                    />
                    <TextField
                      label="Notes (optional)"
                      name="notes"
                      value={newSupplierNotes}
                      onChange={setNewSupplierNotes}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <Button submit loading={supplierSaving}>
                    Add supplier
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
                SKU supplier terms
              </Text>
              <Text as="p" tone="subdued">
                Lead time, MOQ, pack size, and unit cost per SKU. Unit cost is
                used for revenue-at-risk and draft PO totals — enter your cost,
                not retail price, unless you intentionally want retail exposure.
              </Text>

              {termsRows.length > 0 && (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "SKU",
                    "Supplier",
                    "Lead",
                    "MOQ",
                    "Pack",
                    "Unit cost",
                    "",
                  ]}
                  rows={termsRows}
                />
              )}

              {termsResult?.ok === false &&
                (termsResult.intent === "saveSkuTerms" ||
                  termsResult.intent === "deleteSkuTerms" ||
                  termsResult.intent === "importSkuTermsCsv") && (
                  <Banner tone="critical">{termsResult.error}</Banner>
                )}
              {termsResult?.ok &&
                termsResult.intent === "importSkuTermsCsv" &&
                termsResult.importResult && (
                  <Banner tone="success">
                    Imported {termsResult.importResult.ok} row
                    {termsResult.importResult.ok === 1 ? "" : "s"}
                    {termsResult.importResult.errors?.length
                      ? ` (${termsResult.importResult.errors.length} skipped)`
                      : ""}
                    .
                  </Banner>
                )}

              <form onSubmit={handleSaveSkuTerms}>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="SKU"
                      name="sku"
                      value={termsSku}
                      onChange={setTermsSku}
                      autoComplete="off"
                      helpText="Must match your catalog SKU exactly."
                    />
                    <Select
                      label="Supplier"
                      name="supplierId"
                      options={supplierOptions}
                      value={termsSupplierId}
                      onChange={setTermsSupplierId}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Lead time days (optional)"
                      name="leadTimeDays"
                      type="number"
                      min={1}
                      value={termsLead}
                      onChange={setTermsLead}
                      autoComplete="off"
                      helpText="Blank = use supplier default."
                    />
                    <TextField
                      label="MOQ (optional)"
                      name="moq"
                      type="number"
                      min={1}
                      value={termsMoq}
                      onChange={setTermsMoq}
                      autoComplete="off"
                    />
                    <TextField
                      label="Pack size (optional)"
                      name="packSize"
                      type="number"
                      min={1}
                      value={termsPack}
                      onChange={setTermsPack}
                      autoComplete="off"
                    />
                    <TextField
                      label="Unit cost (optional)"
                      name="unitCost"
                      value={termsCost}
                      onChange={setTermsCost}
                      autoComplete="off"
                      helpText="Used for revenue at risk and draft PO cost."
                    />
                  </FormLayout.Group>
                  <Button
                    submit
                    loading={termsSaving}
                    disabled={!suppliers?.length}
                  >
                    Save SKU terms
                  </Button>
                </FormLayout>
              </form>

              <form onSubmit={handleImportCsv}>
                <FormLayout>
                  <TextField
                    label="Import CSV"
                    name="csvText"
                    value={csvText}
                    onChange={setCsvText}
                    multiline={4}
                    autoComplete="off"
                    helpText='Header: sku,supplier,lead_time_days,moq,pack_size,unit_cost — supplier must match an existing name.'
                  />
                  <Button
                    submit
                    loading={csvSaving}
                    disabled={!suppliers?.length}
                  >
                    Import terms CSV
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
