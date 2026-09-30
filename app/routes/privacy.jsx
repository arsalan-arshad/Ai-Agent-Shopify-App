import { publicPage } from "../lib/public-page.server.js";

export const loader = () =>
  publicPage(
    "Privacy Policy — AI Forecast Agent",
    `<h1>AI Forecast Agent — Privacy Policy</h1>
<p><em>Last updated: October 1, 2026</em></p>
<p>
  AI Forecast Agent (&quot;the app&quot;) is a Shopify app that forecasts inventory demand
  from your store&apos;s own order history. This policy explains exactly what data the app
  processes, and what it deliberately never touches.
</p>

<h2>Data we collect</h2>
<ul>
  <li><strong>Shop-level identifiers</strong>: your shop domain and Shopify session/access
    tokens, used only to authenticate API calls back to your own store.</li>
  <li><strong>Product usage data</strong>: SKU, quantity sold, and order date, aggregated
    per day per SKU from Shopify&apos;s Orders API. To avoid counting an edited or re-sent
    order twice, we also keep each order&apos;s ID together with the SKU quantities we
    recorded for it. We never store order totals, line-item prices, or anything beyond
    order ID, SKU, quantity, and date.</li>
  <li><strong>Store settings you enter</strong>: per-SKU or shop-wide reorder lead times,
    and the AI provider (Google Gemini or Anthropic Claude) and API key you choose to add
    in Settings. Your API key is encrypted at rest; only its last four characters are ever
    displayed back to you, for confirmation.</li>
  <li><strong>AI usage metering</strong>: number of questions asked and estimated token
    cost per request, used only to enforce a rate limit and show you your own usage in
    Settings.</li>
  <li><strong>Store contact details</strong>: when you install the app, we read your store
    name, owner name, store email, plan name, and country once via Shopify&apos;s Admin API,
    and refresh them periodically. We use this only to provide support, respond to issues
    with your AI key or forecasts, and — only if you&apos;ve ticked the opt-in checkbox in
    Settings — to occasionally reach out for feedback or about custom Shopify development
    work. You can untick that box at any time, and we never send feedback or custom-work
    messages to a store that hasn&apos;t opted in.</li>
  <li><strong>Feedback</strong>: if you submit a rating or comment from Settings, we store
    it to improve the app. It&apos;s never linked to your customers&apos; data and is deleted
    along with the rest of your shop&apos;s data after you uninstall (see below).</li>
</ul>

<h2>What we never collect</h2>
<p>
  We do not store customer names, emails, phone numbers, shipping or billing addresses, or
  any other personally identifying information about your customers. The app reads only
  the SKU and quantity of each order&apos;s line items, and the forecasting math works from
  per-SKU quantities — never from customer records.
</p>

<h2>How your data is used</h2>
<ul>
  <li>The forecasting engine computes reorder points and days of cover from your
    store&apos;s own inventory and order-quantity history. This runs entirely on our
    server.</li>
  <li>If you use the &quot;Ask the forecast agent&quot; chat, the app sends your question
    and the forecast snapshot (SKU, product title, stock per location and location name,
    daily usage, reorder point, days of cover, and stock status — no customer data) to the
    AI provider you&apos;ve configured, using the API key you supplied yourself. That
    request goes out directly under your own key, not a shared account, and is governed by
    that provider&apos;s own privacy policy.</li>
  <li>We never use your data for advertising, and never sell or share it with anyone other
    than the AI provider you&apos;ve explicitly configured.</li>
</ul>

<h2>Data retention and deletion</h2>
<ul>
  <li>Uninstalling the app deletes your session credentials immediately.</li>
  <li>Forecast history, lead-time settings, AI provider settings, store contact details,
    and feedback are kept briefly in case you reinstall, then permanently deleted — in line with Shopify&apos;s mandatory
    <code>shop/redact</code> webhook, typically ~48 hours after uninstall.</li>
  <li>Because we never store customer-identifying data, there is nothing to export or erase
    when Shopify&apos;s <code>customers/data_request</code> or
    <code>customers/redact</code> webhooks fire; our handlers for both simply confirm no
    customer data is on file.</li>
</ul>

<h2>Security</h2>
<ul>
  <li>Your AI provider API key is encrypted at rest using an application-level encryption
    key stored separately from the encrypted data.</li>
  <li>All traffic between your store, our servers, and Shopify&apos;s Admin API is
    encrypted in transit (HTTPS/TLS).</li>
  <li>Our production database runs on managed hosting with encryption at rest.</li>
</ul>

<h2>Contact</h2>
<p>
  Questions about this policy, or a request to delete your shop&apos;s data sooner than the
  automatic window: <strong>arsalanarshad.dev@gmail.com</strong>.
</p>`,
  );
