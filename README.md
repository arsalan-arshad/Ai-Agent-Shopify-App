# AI Forecast Agent — Shopify App Scaffold

An inventory & demand forecasting app for Shopify merchants, with a
conversational AI agent layer on top of a deterministic forecasting engine.

**Why this and not another inventory app**: most "AI" apps on the Shopify
App Store are support chatbots. This one uses the agent to *explain and
reason over* real reorder-point math (see `app/lib/forecasting.js`) —
the agent never invents numbers, it interprets them. That combination
(auditable math + conversational interface) is the differentiator.

## What's in this scaffold

- `app/lib/forecasting.js` — weighted moving average, reorder point,
  days-of-cover, and status classification. Pure functions, unit-testable,
  no external dependencies. This is the credible, defensible core.
- `app/lib/ai-agent.js` — Claude API wrapper. Grounds every answer in the
  forecast snapshot; refuses to invent numbers not in the data.
- `app/lib/shopify.server.js` — Shopify API client setup, with inline notes
  on the offline-token expiry/refresh lifecycle (relevant if you reuse this
  for token-migration client work — see notes in the file).
  Currently `read`-only scopes — see `shopify.app.toml`. Add write
  scopes when you build auto-reorder actions.
- `app/routes/app._index.jsx` — main dashboard (Polaris UI): forecast table
  + agent chat panel.
- `app/routes/api.agent-chat.jsx` — API route the chat panel calls.
- `app/routes/webhooks.orders-updated.jsx` — webhook stub for keeping
  usage data fresh; where the real per-SKU history aggregation needs to
  be built out.
- `app/graphql/queries.js` — Admin GraphQL queries for orders & inventory.

## What's now real (as of the last update)

- **Prisma schema** (`prisma/schema.prisma`): `Session` (required by
  `PrismaSessionStorage`), `DailyUsage` (real per-SKU-per-day sales,
  replacing the old placeholder array), and `LeadTimeSetting` (per-SKU
  or shop-wide lead time, no longer a single hardcoded constant).
- **Usage aggregation** (`app/lib/usage-history.server.js`): the webhook
  handler now calls `recordOrderUsage` on every order, and the dashboard
  loader queries real 30-day history via `getUsageHistory` instead of a
  placeholder array.
- **Historical backfill** (`app/lib/backfill.server.js`): seeds
  `DailyUsage` from existing orders on install, so a freshly installed
  app isn't forecasting off zero data for its first month. Not yet wired
  to an actual trigger point (see "Still stubbed" below) — the function
  is ready, it just needs to be called from somewhere.

## What's intentionally stubbed (your next steps)

1. **Trigger the backfill**: `backfillUsageHistory()` exists but nothing
   calls it yet. Wire it to fire once after OAuth completes on install —
   easiest spot is a check in the `app._index` loader ("if
   `getTrackedSkus(shop)` is empty, kick off backfill") or a dedicated
   `afterAuth` hook if you're using `@shopify/shopify-app-remix`'s hook
   system.
2. **Webhook double-counting**: flagged inline in
   `webhooks.orders-updated.jsx` — `orders/updated` fires on edits and
   refunds too, not just new sales, and this v1 doesn't yet distinguish
   those from genuine new line items. Low risk in a demo, worth fixing
   before any real merchant relies on the numbers.
3. **Auth/session routes**: the official Shopify Remix template generates
   `app/routes/auth.$.jsx`, `app/routes/app.jsx` (layout with App Bridge),
   and `app/entry.server.jsx`. Fastest path: run
   `npm create @shopify/app@latest -- --template remix` in a separate
   folder and merge these custom files in, rather than hand-writing
   Shopify's boilerplate.
4. **Lead time per SKU**: currently a single global constant
   (`DEFAULT_LEAD_TIME_DAYS`). Real merchants have different lead times
   per supplier/SKU — worth a settings page early.

## Setup (on your own machine, not in this sandbox)

```bash
# 1. Scaffold Shopify's own boilerplate first (auth routes, App Bridge, etc.)
npm create @shopify/app@latest -- --template remix
# then copy app/lib, app/graphql, and the two custom routes from this
# scaffold into the generated project, merging package.json dependencies.

# 2. Install dependencies
npm install

# 3. Set up Prisma
npx prisma init --datasource-provider sqlite
npx prisma migrate dev --name init

# 4. Copy env template and fill in credentials
cp .env.example .env
# — Get SHOPIFY_API_KEY / SECRET from partners.shopify.com (create an app)
# — Get ANTHROPIC_API_KEY from console.anthropic.com

# 5. Run against a dev store
shopify app dev
```

You'll need a **Shopify Partner account** (free) and a **development
store** (free, from the Partner Dashboard) to actually install and test
this — neither of those can be created from inside this chat, they're
account-level steps on Shopify's side.

## Roadmap after the MVP works

- Settings page: per-SKU/per-supplier lead time, service-level target
- Daily digest via email or Slack (reuse `generateDailyDigest`)
- Auto-draft purchase orders for `reorder_now` SKUs (needs `write_inventory`
  scope — bigger app-review bar, add once the read-only version is proven)
- Multi-location inventory awareness (the GraphQL query already pulls
  per-location quantities — just not surfaced in the UI yet)
