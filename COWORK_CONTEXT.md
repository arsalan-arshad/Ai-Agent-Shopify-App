# AI Forecast Agent — Project Context (for Claude Cowork)

_Snapshot as of 2026-09-29, branch `main`, commit `4b0726c`. Verify against code before relying on any detail._
_Contains NO secrets. Never paste `.env` values into chat or docs._

## 1. What this app is
Embedded Shopify app (Remix + Polaris) that forecasts per-SKU inventory demand and flags when to reorder.
- **Deterministic engine** (`app/lib/forecasting.js`) computes numbers.
- **AI agent** (Google Gemini via `@google/genai`, `app/lib/ai-agent.js`) explains them in chat. Rule: the agent must never invent numbers.
- Differentiator: auditable reorder-point math + conversational interface (not a support chatbot).

## 2. Stack
Remix 2.15 (Vite) · React 18 · Polaris 13 · App Bridge React 4 · `@shopify/shopify-app-remix` 3.7 · Prisma 5 (SQLite dev) · Shopify CLI 3.75 · Node >= 18.20.
No test suite. `npm run lint` exists but there's no ESLint config/dependency in the repo.

## 3. Forecasting logic (`forecasting.js`)
- `weightedMovingAverage(history, periods=4)`: linear weights, recent heaviest.
- `calculateReorderPoint`: WMA(14 days) x leadTime + safety stock; safety = z(1.65) x stdDev x sqrt(leadTime).
- `daysOfCover = stock / avgDailyUsage` (Infinity if no sales).
- `classifyStockStatus`: `reorder_now` (cover <= lead time), `reorder_soon` (<= 1.5x), `healthy`, `no_recent_sales`.

## 4. Data flow
1. Install/OAuth -> `app.jsx` layout calls `authenticate.admin`.
2. `app._index.jsx` loader: fetches inventory (`INVENTORY_LEVELS_QUERY`, first 50 items, first location's "available" only), reads `DailyUsage` history + lead time from Prisma, builds `forecastSnapshot`. If no tracked SKUs, fires `backfillUsageHistory` (fire-and-forget, `maxPages: 10`).
3. Webhook `webhooks.orders-updated.jsx` -> `recordOrderUsage` writes `DailyUsage(shop, sku, date, quantity)`.
4. Chat: UI POSTs `question` + `snapshot` to `api.agent-chat.jsx` -> `askForecastAgent` (model `gemini-3.6-flash`, snapshot injected in system prompt).

Prisma models: `Session`, `DailyUsage` (unique shop+sku+date), `LeadTimeSetting` (shop or SKU-level). Lead-time settings have no UI yet.

## 5. Config state
- `shopify.app.toml`: `client_id = ""` (**not linked to Partners**), `application_url` and redirect URL are a temporary trycloudflare tunnel, `embedded = true`, webhooks `api_version = "2026-10"`, scopes `read_orders, read_products, read_inventory, read_locations`. **No `[[webhooks.subscriptions]]` declared.**
- `shopify.web.toml`: webhooks_path `/webhooks/orders-updated`.
- `shopify.server.js`: `ApiVersion.January25`, `AppDistribution.AppStore`, `unstable_newEmbeddedAuthStrategy: true`, `PrismaSessionStorage`.
- Env vars used: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `GEMINI_API_KEY`, `NODE_ENV`. (`ANTHROPIC_API_KEY` is obsolete.)

## 6. Verified problems / risks (found by reading the code)
**Blockers for App Store review**
1. Not linked to a Partner app (`client_id` empty); tunnel URL, no production hosting.
2. Mandatory compliance webhooks missing: `customers/data_request`, `customers/redact`, `shop/redact`. Also no `app/uninstalled` handler (stale sessions/data remain).
3. Order webhooks not declared in `shopify.app.toml`, so the handler may never fire in a deployed app.
4. API version mismatch (`January25` in code vs `2026-10` in toml).
5. SQLite in production is not viable; `prisma/dev.sqlite` is committed to git (may contain session tokens); `build/` is committed.
6. `Session` model lacks refresh-token fields. If using expiring offline tokens (see notes in `shopify.server.js`), confirm the session-storage package version and schema support them; verify refresh works in webhook/background context.
7. No `app/routes/auth.$.jsx` catch-all from the official template; the custom `auth.login`/`auth.callback` routes should be validated end-to-end (or replaced with the template pattern).

**Correctness / security**
8. **Webhook double-counting is NOT actually fixed**, despite SETUP_GUIDE saying so. `orders/updated` still re-records every line item on any edit; the code comment promises a line-item diff that isn't implemented. Needs idempotency (e.g. store processed order id + line item quantities, or use `orders/create` + refund/edit deltas).
9. `api.agent-chat.jsx` trusts a **client-supplied `snapshot`**, so a user can inject arbitrary data or prompt text. Rebuild the snapshot server-side from DB + Admin API instead. Add rate limiting.
10. `api.agent-chat.jsx` writes debug logs to `/tmp/agent-chat-debug.log` (including the user's question). Remove for production.
11. Inventory query is unpaginated (50 items) and uses only the first location's first level; `inventoryLevels(first: 5)`. Larger catalogs and multi-location merchants get wrong/partial data. Items without SKU are silently dropped.
12. Backfill capped at 10 pages, fire-and-forget with no retry/status; `RECENT_ORDERS_QUERY` covers recent orders only (default order access window may be limited to 60 days without `read_all_orders`).
13. `calculateReorderPoint` divides by `dailyUsageHistory.length` (NaN if empty); guard the empty case.
14. Gemini free tier: rate limits (429) and data-use terms are unsuitable for production merchant data. Decide on a paid tier/provider and update privacy policy accordingly.

**Housekeeping**
15. README/SETUP_GUIDE are stale (mention Claude/Anthropic, `.env.example` that doesn't exist, "webhook fixed").
16. `.gitignore` only has `node_modules` and `.env`; add `build/`, `*.sqlite`, `.shopify/`, `.claude/settings.local.json`.
17. `extensions/`, `public/`, `.shopifyapp/` are empty placeholders.

## 7. Roadmap (from README)
Settings page (per-SKU lead time, service level) · daily digest (email/Slack; not built — would reuse `askForecastAgent`) · auto-draft purchase orders (needs `write_inventory`, higher review bar) · multi-location UI.

## 8. Publishing plan (suggested order)
1. `shopify app config link` to the Partner app; commit the real `client_id`.
2. Fix items 3, 4, 7, 8, 9 (correctness) and add compliance webhooks (item 2).
3. Move to Postgres, deploy to real HTTPS hosting, set env vars there, `shopify app deploy`.
4. Test on a dev store with real-ish order data (install, uninstall/reinstall, webhook replay, chat).
5. Billing (Billing API or free plan), privacy policy + support URL, listing assets, then submit for review.

## 9. Working agreements
- Ask before deploying, releasing an app version, pushing, or submitting for review.
- Keep scopes read-only unless a write feature is approved.
- Keep forecast math pure/deterministic; the AI only explains it.
- Never expose secrets; reference env var names only.
