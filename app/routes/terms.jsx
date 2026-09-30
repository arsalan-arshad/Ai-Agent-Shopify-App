import { publicPage } from "../lib/public-page.server.js";

export const loader = () =>
  publicPage(
    "Terms of Service — AI Forecast Agent",
    `<h1>AI Forecast Agent — Terms of Service (Merchant Agreement)</h1>
<p><em>Last updated: October 1, 2026</em></p>
<p>By installing AI Forecast Agent (&quot;the app&quot;) on your Shopify store, you agree to these terms.</p>

<h2>What the app does</h2>
<p>
  The app analyzes your store&apos;s order history to compute per-SKU reorder points, days
  of cover, and stock status, and lets you ask an AI assistant questions about that
  forecast. All forecast numbers are computed deterministically by our own code; the AI
  assistant only explains numbers we&apos;ve already calculated — it never invents figures.
</p>

<h2>Bring your own AI key</h2>
<p>
  The app is free to install, with no shared AI service of our own. To use &quot;Ask the
  forecast agent,&quot; you add your own Google Gemini or Anthropic Claude API key in
  Settings. Any usage costs charged by your chosen AI provider are your responsibility, not
  ours — check your provider&apos;s pricing before heavy use. The forecast table itself
  (SKUs, stock, reorder points) works without an AI key.
</p>

<h2>Your responsibilities</h2>
<p>
  You&apos;re responsible for keeping your AI provider API key confidential, for the
  accuracy of your store&apos;s product and inventory data in Shopify, and for reviewing
  forecast recommendations before acting on them — the app is a decision-support tool, not
  a guarantee of sales or stock outcomes.
</p>

<h2>No warranty; limitation of liability</h2>
<p>
  The app is provided &quot;as is.&quot; We do not guarantee forecasts will be accurate or
  that the app will be free of interruptions or errors. To the maximum extent permitted by
  law, we are not liable for lost sales, stockouts, overstock, or other business losses
  arising from use of the app or its forecasts.
</p>

<h2>Changes and termination</h2>
<p>
  You may uninstall the app at any time from your Shopify admin. We may update these terms
  or the app&apos;s features; material changes will be reflected in an updated effective
  date.
</p>

<h2>Contact</h2>
<p>Questions about these terms: <strong>arsalanarshad.dev@gmail.com</strong>.</p>`,
  );
