# Setup Guide

Architecture and file overview live in `README.md` — this is just the
step-by-step to get a working install on a real Partner org + dev store.
(Superseded: this used to describe an Anthropic-Claude-only, SQLite-forever
scaffold with an unfixed webhook double-counting bug. All three are now
addressed — see README's "Known gaps" for what's actually still open.)

## 1. Shopify Partner account + app record

1. Go to [partners.shopify.com](https://partners.shopify.com) and create a
   free Partner account if you don't have one.
2. From the Partner Dashboard, create an app (or use an existing one) —
   this app expects **public/App Store distribution**
   (`AppDistribution.AppStore` in `app/lib/shopify.server.js`).
3. From the repo root: `npm run config:link` (`shopify app config link`).
   This writes a real `client_id` into `shopify.app.toml` and lets you
   pick which Partner app this repo is linked to.

## 2. Development store

From the Partner Dashboard, create a free development store (or reuse one
you already have). `shopify app dev` will prompt you to pick one the
first time you run it.

## 3. Environment

```bash
cp .env.example .env
```

Fill in from the Partner Dashboard's app **Configuration → Client
credentials**:
```
SHOPIFY_API_KEY=<Client ID>
SHOPIFY_API_SECRET=<Client secret>
```

Generate an encryption key for merchant-supplied AI API keys:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
paste the result into `ENCRYPTION_KEY`.

Leave `SHOPIFY_APP_URL` blank for local dev — `shopify app dev` sets it
to a temporary tunnel URL automatically and updates `shopify.app.toml`'s
`application_url`/`redirect_urls` for you (`automatically_update_urls_on_dev`).

`DATABASE_URL` can stay as the default SQLite path for local dev.

## 4. Database

```bash
npx prisma generate
npx prisma migrate dev
```

## 5. Run it

```bash
npm run dev
```

This starts the Vite dev server, opens a Cloudflare tunnel, and prompts
you to select the dev store to install into. Once it's running, open the
printed preview URL (or find the app under **Apps** in the dev store's
Shopify admin).

**First install**: the dashboard loader backfills historical order data
in the background on first load (up to 10 pages of recent orders) — the
forecast table fills in within a minute or two rather than starting from
zero. Check the terminal logs to see progress.

**AI chat**: the dashboard's chat panel will prompt you to add a Gemini
or Claude API key — that's expected, there's no shared/trial key (see
README). Add one from **Settings** in the app nav.

## 6. Testing webhooks locally

`shopify app dev` forwards live webhook deliveries from your dev store
through the tunnel automatically — placing a real order (or editing one)
in the dev store admin should trigger `webhooks.orders-updated.jsx`. To
fire a webhook manually without a real order, use:
```bash
shopify app webhook trigger
```
and pick a topic (e.g. `orders/updated`, `customers/redact`) from the
list `shopify.app.toml` declares.

## 7. Before submitting for review

See README's "Known gaps" section and the project's publishing checklist
(hosting, Postgres, privacy policy, listing assets, billing). Don't run
`shopify app deploy` or submit from the Partner Dashboard without
double-checking those first.
