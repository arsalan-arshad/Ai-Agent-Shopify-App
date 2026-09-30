# AI Forecast Agent

An embedded Shopify app that forecasts per-SKU inventory demand and tells
merchants when to reorder. A deterministic engine does the math; a
conversational AI agent explains it and never invents numbers.

**Why this and not another inventory app**: most "AI" apps on the Shopify
App Store are support chatbots bolted onto a dashboard. This one uses the
agent to *explain and reason over* real reorder-point math (see
`app/lib/forecasting.js`) — the agent is grounded in a snapshot the
deterministic engine computed and refuses to answer outside it. That split
(auditable math + conversational interface) is the differentiator.

## Stack

Remix 2 (Vite) · React 18 · Polaris 13 · App Bridge 4 (via the raw
`app-bridge.js` script tag + `<ui-nav-menu>`, not `@shopify/app-bridge-react`'s
provider) · `@shopify/shopify-app-remix` 6 · Prisma 6 (SQLite in dev,
Postgres in production) · Node >= 20.19 (tested on 22).

## AI providers — bring your own key

There is **no shared or trial AI key**. Each merchant adds their own
Google Gemini or Anthropic Claude API key from the in-app **Settings**
page (`app/routes/app.settings.jsx`); it's encrypted at rest
(`app/lib/crypto.server.js`, AES-256-GCM, key from `ENCRYPTION_KEY`) and
decrypted only server-side to call their chosen provider
(`app/lib/ai-agent.js`). Until a merchant adds a key, the forecast table
and reorder math work as normal (they're deterministic, not AI) but the
chat panel shows a prompt to set one up instead of calling anything.
Per-question token counts and an estimated cost are logged to
`AiUsageLog` and shown on the Settings page — that's an estimate for the
merchant's own visibility, not a bill; they're charged by their provider
directly.

## Data model (`prisma/schema.prisma`)

- `Session` — required by `PrismaSessionStorage`; includes `refreshToken`
  / `refreshTokenExpires` for expiring offline access tokens (Shopify
  requires these for all public apps as of Jan 1, 2027).
- `DailyUsage` — one row per SKU per day per shop, populated by the
  `orders/updated`/`orders/create` webhook and by the install-time
  backfill. No customer-identifying fields.
- `ProcessedOrder` — last recorded line-item snapshot per order, so the
  webhook (which can fire many times per order) only applies the delta
  instead of re-adding the full quantity each time.
- `LeadTimeSetting` — per-SKU or shop-wide reorder lead time, editable
  from Settings.
- `ShopAiSettings` — a shop's chosen provider + encrypted API key.
- `AiUsageLog` — one row per AI chat call, for the usage panel and for
  basic per-shop rate limiting.

## Key files

- `app/lib/forecasting.js` — weighted moving average, reorder point,
  days-of-cover, status classification. Pure, deterministic, no
  dependencies — keep it that way.
- `app/lib/forecast-snapshot.server.js` — the one place the forecast
  snapshot gets built from live Admin API + DB data (paginated,
  multi-location aware). Both the dashboard and the chat endpoint call
  this instead of trusting client-supplied data.
- `app/lib/ai-agent.js` — Gemini/Claude provider abstraction, grounded in
  the forecast snapshot, logs usage.
- `app/lib/ai-settings.server.js` / `crypto.server.js` / `ai-pricing.js` —
  BYOK storage, encryption, and cost estimation.
- `app/lib/usage-history.server.js` — DailyUsage/LeadTimeSetting queries
  and the idempotent `recordOrderUsage`.
- `app/routes/app._index.jsx` — dashboard: forecast table + chat.
- `app/routes/app.settings.jsx` — AI provider key, usage, lead times.
- `app/routes/webhooks.*` — order usage tracking + the mandatory
  compliance webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`, `app/uninstalled`).

## Local setup

```bash
npm install
cp .env.example .env        # fill in real values, see comments in the file
npx prisma migrate dev       # creates prisma/dev.sqlite locally
shopify app config link      # one-time: link to your Partner app
npm run dev                  # shopify app dev — installs to a dev store, opens a tunnel
```

You'll need a free **Shopify Partner account** and a free **development
store** from the Partner Dashboard — both are account-level steps on
Shopify's side, not something this repo can do for you.

## Known gaps / roadmap

- **Production hosting**: `application_url` is currently a temporary
  `trycloudflare.com` tunnel. Needs a stable HTTPS host (Fly.io, Render,
  Railway, etc.) before submitting for review.
- **Postgres**: `prisma/schema.prisma`'s datasource is SQLite for local
  dev; switch `provider` to `"postgresql"` and point `DATABASE_URL` at a
  real instance for production — SQLite doesn't work across multiple
  server instances.
- **Daily digest**: not built yet — would call `askForecastAgent`
  (`ai-agent.js`) on a schedule and send the summary by email/Slack.
- **Auto-draft purchase orders**: would need a `write_inventory` (or
  similar) scope — bigger App Store review bar, worth adding once the
  read-only version is proven.
