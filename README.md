# AI Forecast Agent — Smart Inventory & Demand Forecasting for Shopify

<p align="center">
  <img src="assets/app_banner.png" alt="AI Forecast Agent banner" width="100%" />
</p>

> **Open-Source (MIT)** | Built for the Shopify Merchant & Developer Community | Open for PRs & Discussions

[![CI](https://github.com/arsalan-arshad/Ai-Agent-Shopify-App/actions/workflows/ci.yml/badge.svg)](https://github.com/arsalan-arshad/Ai-Agent-Shopify-App/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Shopify API](https://img.shields.io/badge/Shopify%20API-2026--10-95BF47?logo=shopify&logoColor=white)](shopify.app.toml)
[![Remix](https://img.shields.io/badge/Remix-2%20(Vite)-000000?logo=remix&logoColor=white)](https://remix.run)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-339933?logo=node.js&logoColor=white)](package.json)
[![Hosted on Railway](https://img.shields.io/badge/Hosted%20on-Railway-0B0D0E?logo=railway&logoColor=white)](https://agent-forecast-production.up.railway.app)

---

## 1. Overview & Vision

**The problem:** most "AI" apps on the Shopify App Store are support chatbots bolted onto a
basic dashboard — the "AI" never actually touches the numbers it talks about, and several
charge $50–$300/mo for what amounts to a wrapper around a single LLM call.

**The approach here is a dual-engine architecture, deliberately split in two:**

1. **A pure, deterministic math engine** (`app/lib/forecasting.js`) — weighted moving average,
   reorder-point calculation, days-of-cover, stock-status classification. No AI, no
   randomness, no network calls. Given the same inputs, it always returns the same numbers,
   and every number is traceable back to a formula a merchant (or a reviewer) can audit.
2. **A grounded conversational AI co-pilot** (`app/lib/ai-agent.js`) that sits *on top of*
   those numbers to explain and answer follow-up questions. The agent's system prompt is
   built from a server-side forecast snapshot only — it is explicitly instructed never to
   invent a figure, and the snapshot is rebuilt from the database and the Shopify Admin API
   on every request rather than trusted from the client.

That split — auditable math underneath, a conversational interface on top, never the reverse
— is the core differentiator from a plain "GPT wrapper" app.

**Business model:** the app is free to install. There is no shared or trial AI key and no
AI billing code in the app itself — each merchant brings their own Google Gemini or
Anthropic Claude API key (BYOK), encrypted at rest, and is billed by their provider directly.
The one thing Shopify's submission process still requires regardless of price is a formal
plan registration, so the app is listed on **Shopify App Pricing** as a single public **$0
Free plan**.

---

## 2. Implemented Features

- **Deterministic Inventory Math Engine** (`app/lib/forecasting.js`):
  - Weighted moving average over a 14-day window, with more recent days weighted more
    heavily (`weightedMovingAverage`).
  - Reorder point = (average daily usage × lead time) + safety stock, where safety stock is
    a standard-deviation buffer scaled by a configurable service-level factor
    (`calculateReorderPoint`, default z ≈ 1.65, ~95% service level).
  - Days-of-cover (`daysOfCover`) and a four-state stock classification — `reorder_now`,
    `reorder_soon`, `healthy`, `no_recent_sales` (`classifyStockStatus`).
  - Multi-location aware: `forecast-snapshot.server.js` sums `available` inventory across
    every location returned for a SKU, not just the first one.
  - Per-SKU lead times with a shop-wide default fallback, editable from Settings.

- **Enterprise-Grade AI Co-pilot (BYOK)**:
  - Bring-Your-Own-Key — Google Gemini (`gemini-3.6-flash`) or Anthropic Claude
    (`claude-sonnet-5`), chosen and saved per shop. No shared/fallback server-side key exists
    anywhere in the code.
  - AES-256-GCM authenticated encryption at rest for every stored key
    (`app/lib/crypto.server.js`), keyed by a 32-byte `ENCRYPTION_KEY` that never leaves
    environment variables.
  - Strict grounding: the chat endpoint (`api.agent-chat.jsx`) rebuilds the forecast snapshot
    server-side on every call instead of trusting a client-supplied one, and the agent's
    system prompt instructs it to answer only from that JSON and say so plainly when the data
    doesn't cover the question.
  - Per-shop rate limiting — 20 AI questions per rolling 60-second window, backed by the same
    `AiUsageLog` table used for cost metering (`app/lib/ai-settings.server.js`,
    `isRateLimited`).
  - Live token counts and an estimated USD cost per request, shown on the Settings usage
    panel (`app/lib/ai-pricing.js`) — an estimate for the merchant's own visibility; they're
    billed by their AI provider directly, never by this app.

- **Shopify-Native Experience & Polaris UI**:
  - Embedded App Bridge 4, loaded from Shopify's own CDN and gated to `/app` and `/app/*`
    routes only (public pages like `/auth/login`, `/privacy`, `/terms` render clean, with no
    embedded-admin script trying to initialize outside the admin iframe).
  - Polaris 13 dashboard with a forecast table, inventory-health status tags, and an in-app
    AI chat drawer.
  - Settings page: AI provider key management, usage/cost panel, per-SKU or shop-wide lead
    times, and a merchant contact/feedback card.

- **Webhook Pipeline & Data Integrity**:
  - Delta-based order tracking (`orders/create` + `orders/updated` → one handler,
    `webhooks.orders-updated.jsx`) — `ProcessedOrder` stores the last line-item snapshot per
    order so a redelivered or edited webhook only applies the *difference* to `DailyUsage`,
    never re-adds the full quantity and double-counts.
  - Install-time usage backfill (`app/lib/backfill.server.js`) so a brand-new install isn't
    staring at an empty forecast table.
  - The full mandatory compliance webhook set — `customers/data_request`, `customers/redact`,
    `shop/redact`, plus `app/uninstalled` — all declared in `shopify.app.toml`, all verified
    via `authenticate.webhook`'s built-in HMAC check. `shop/redact` tears down every
    shop-keyed table (`DailyUsage`, `ProcessedOrder`, `LeadTimeSetting`, `AiUsageLog`,
    `ShopAiSettings`, `ShopProfile`, `Feedback`, `Session`) in one Prisma transaction.
  - `Session` carries `refreshToken`/`refreshTokenExpires` for Shopify's expiring-offline-token
    requirement (mandatory for all public apps from January 2027).

---

## 3. Architecture & Tech Stack

```
app/
├── lib/
│   ├── forecasting.js                # Pure math: WMA, reorder point, days-of-cover,
│   │                                  # status classification — zero dependencies, zero
│   │                                  # side effects, zero AI calls. The core of the app.
│   ├── forecast-snapshot.server.js   # Builds the forecast snapshot from live Admin API +
│   │                                  # DB (paginated, multi-location aware). The one place
│   │                                  # it's built — dashboard and chat both call this.
│   ├── ai-agent.js                   # Gemini / Claude BYOK call abstraction, grounded
│   │                                  # strictly in the snapshot, never generates numbers.
│   ├── ai-settings.server.js         # Encrypted key storage, usage logging, per-shop
│   │                                  # rate limiting (isRateLimited).
│   ├── ai-pricing.js                 # Per-token USD cost estimation for the usage panel.
│   ├── crypto.server.js              # AES-256-GCM encrypt/decrypt for merchant API keys.
│   ├── usage-history.server.js       # DailyUsage / LeadTimeSetting queries, the idempotent
│   │                                  # recordOrderUsage delta logic.
│   ├── backfill.server.js            # Seeds usage history from historical orders on install.
│   ├── merchant.server.js            # ShopProfile sync from the Admin API, marketing
│   │                                  # opt-in, feedback capture.
│   ├── shopify.server.js             # @shopify/shopify-app-remix config, OAuth, sessions.
│   └── db.server.js                  # Prisma client singleton.
├── routes/
│   ├── app._index.jsx                # Dashboard: forecast table + AI chat drawer.
│   ├── app.settings.jsx              # AI key, usage panel, lead times, contact & feedback.
│   ├── api.agent-chat.jsx            # Chat endpoint — rebuilds the snapshot server-side,
│   │                                  # rate-limits, never trusts client-supplied data.
│   ├── auth.$.jsx                    # Shopify-template OAuth entry point.
│   ├── auth.login.jsx                # OAuth fallback — Shopify-initiated installs only,
│   │                                  # no manual shop-domain entry form (App Store 2.3.1).
│   ├── auth.callback.jsx             # OAuth callback.
│   ├── privacy.jsx / terms.jsx       # Public policy pages.
│   ├── webhooks.orders-updated.jsx   # Delta-based usage tracking.
│   └── webhooks.{app.uninstalled,customers.data_request,customers.redact,
│       shop.redact}.jsx              # Mandatory compliance webhooks.
├── graphql/queries.js                 # Admin GraphQL: inventory levels, shop profile.
└── root.jsx                          # App Bridge script (gated to /app/* only), favicons.

prisma/
├── schema.prisma                     # 8 models — see section 4.
└── migrations/                       # Hand-authored SQL, applied via `prisma migrate
                                       # deploy` on every deploy (see section 7).
```

**Stack:** Remix 2 (Vite) · React 18 · Polaris 13 · App Bridge 4 ·
`@shopify/shopify-app-remix` ^6.0.1 · Prisma ^6.19.3 on PostgreSQL (both dev and production —
Prisma supports one database provider per project, so SQLite was dropped entirely) ·
`@google/genai` + `@anthropic-ai/sdk` · Node ≥20.19.

---

## 4. Database Schema (`prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `Session` | Required by `@shopify/shopify-app-session-storage-prisma`. Includes `refreshToken`/`refreshTokenExpires` for Shopify's expiring offline-token requirement. |
| `DailyUsage` | One row per SKU per day per shop — the forecasting engine's raw input. Populated by the orders webhook and the install-time backfill. |
| `ProcessedOrder` | The last recorded `{sku: quantity}` snapshot per order, so a redelivered/edited webhook only applies the delta instead of double-counting. |
| `LeadTimeSetting` | Per-SKU or shop-wide (`sku: ""`) reorder lead time, editable from Settings. |
| `ShopAiSettings` | A shop's chosen AI provider plus its AES-256-GCM-encrypted API key. |
| `AiUsageLog` | One row per AI chat call — powers the Settings usage/cost panel and the per-shop rate limiter. |
| `ShopProfile` | Store-owner contact details synced from the Admin API (name, email, plan, country) plus the marketing/contact opt-in flag. Never customer data. |
| `Feedback` | Rating + optional comment submitted from the Settings "Contact & feedback" card. |

Every shop-keyed table above is wiped in a single transaction by the `shop/redact` webhook.
No model anywhere in the schema stores customer-identifying data — `DailyUsage` is aggregated
at `(shop, sku, date)`, not per-order or per-customer — which is what lets the
`customers/data_request` and `customers/redact` handlers honestly report "nothing to
export/redact."

---

## 5. Local Development Quickstart

Prerequisites: a free **Shopify Partner account** and a free **development store** (both
created from the [Partner Dashboard](https://partners.shopify.com), not something this repo
can do for you), the **Shopify CLI** (installed as a dev dependency, or `npm i -g
@shopify/cli`), and a local **PostgreSQL** — the app only supports Postgres, in dev and
production alike. On macOS, [Postgres.app](https://postgresapp.com) is the simplest option.

```bash
# 1. Create a local database
createdb forecast

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Fill in SHOPIFY_API_KEY / SHOPIFY_API_SECRET from your Partner app's Client credentials,
# DATABASE_URL (e.g. postgresql://YOUR_MAC_USERNAME@localhost:5432/forecast), and generate
# ENCRYPTION_KEY with:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Apply the schema
npx prisma migrate deploy

# 5. Link to your Partner app (one-time)
shopify app config link

# 6. Start the dev server — opens a tunnel and installs to your dev store
npm run dev
```

`npx prisma studio` opens a browser view of every table — useful for inspecting what the
webhook handlers and backfill actually wrote. Never point a local `DATABASE_URL` at the
production database.

---

## 6. Verification & Test Suite

There's no AI magic here to "trust" — the forecasting math is pure functions you can call
directly in a REPL and check by hand. What's verified before every merge:

```bash
npm run build      # remix vite:build — production build must succeed; this is what CI runs
                    # on every pull request (.github/workflows/ci.yml)
npm run stats       # scripts/stats.mjs — prints aggregate portfolio numbers (install count,
                    # active stores, AI questions answered, SKUs tracked, feedback average)
                    # straight from Postgres, read-only, no per-shop data
npx prisma studio   # inspect what a webhook handler or the backfill actually wrote
```

An automated unit/integration test suite (Jest or Vitest around `forecasting.js` and the
webhook delta logic in particular) is on the roadmap below and is one of the most useful
places for a contribution — the math being pure functions makes it straightforward to test.

---

## 7. Production Deployment (Railway)

The live instance runs on [Railway](https://railway.app), with a Postgres plugin in the same
project and auto-deploy on every push to `main`. The deploy pipeline is just two npm scripts:

```bash
npm run docker-start   # Railway's start command — runs setup, then start
#   ├── npm run setup   →  prisma generate && prisma migrate deploy   (applies pending migrations)
#   └── npm run start   →  remix-serve ./build/server/index.js
```

Required environment variables (set in Railway's dashboard, never committed — see
`.env.example`): `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`,
`SCOPES`, `ENCRYPTION_KEY`, `NODE_ENV=production`, and a `PORT` matching whatever target port
your platform's public domain is pinned to.

Deploying your own fork elsewhere (Fly.io, Render, etc.) works the same way — any host that
can run `npm run docker-start` against a Postgres instance and exposes a stable HTTPS URL is
fine. After changing the host, update `application_url` and `redirect_urls` in
`shopify.app.toml` and run `shopify app deploy` to register the change with Shopify, since
editing the TOML locally has no effect on Shopify's side until it's actually deployed.

---

## 8. Open-Source Roadmap

- [x] Deterministic weighted-moving-average forecasting engine + reorder-point math
- [x] BYOK Google Gemini & Anthropic Claude integration with AES-256-GCM encryption at rest
- [x] Embedded Polaris UI dashboard with an in-app AI chat drawer
- [x] Per-shop AI rate limiting and token/cost usage tracking
- [x] Idempotent, delta-based order-webhook usage tracking
- [x] Multi-location inventory aggregation and per-SKU/shop-wide lead times
- [x] Full mandatory GDPR/App Store compliance webhook set, with a real full-teardown redact
- [x] OAuth install flow hardened against manual shop-domain entry (App Store 2.3.1)
- [ ] Automated test suite (Jest/Vitest) around `forecasting.js` and the webhook delta logic
- [ ] Automated daily email/Slack stockout digest
- [ ] Auto-draft Purchase Orders (would need a `write_inventory` scope — bigger App Store
      review bar, worth adding once there's real demand)
- [ ] Multi-currency cost-of-goods (COGS) margin optimization
- [ ] Shopify App Store listing — submission in progress

Contributions are very welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a
PR (the short version: keep `forecasting.js` pure, keep scopes read-only unless a write
feature is specifically agreed on first, and run `npm run build` before pushing). Found a
security issue? Please see [`SECURITY.md`](SECURITY.md) instead of opening a public issue.
