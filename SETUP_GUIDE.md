# Shopify AI Forecast App - Setup Guide

Your app is now fully scaffolded with Shopify's official auth system and your custom forecasting logic. Here's what's been done and what you need to do next.

## ✅ What's Been Completed

### 1. **Official Shopify Remix Scaffold** ✅
- Created auth routes: `/auth/login` → `/auth/callback`
- Added app layout protection (`app.jsx`) — all `app/*` routes require authentication
- Set up App Bridge entry files (`entry.server.tsx`, `entry.client.tsx`)
- Configured Remix (`remix.config.js`) and Vite (`vite.config.ts`)

### 2. **Custom Business Logic Merged** ✅
- **Forecasting**: `app/lib/forecasting.js` — reorder point calculation
- **AI Agent**: `app/lib/ai-agent.js` — Claude API integration
- **Usage Tracking**: `app/lib/usage-history.server.js` — DailyUsage table queries
- **Backfill**: `app/lib/backfill.server.js` — seeds historical data on first install
- **Routes**:
  - `app/routes/app._index.jsx` — Main dashboard with backfill trigger
  - `app/routes/api.agent-chat.jsx` — AI agent endpoint
  - `app/routes/webhooks.orders-updated.jsx` — Order tracking (fixed double-counting)

### 3. **Webhook Double-Counting Fixed** ✅
- Added `financial_status` check: skips refunded/voided orders
- Only records on `orders/create` or valid `orders/updated` events
- Logs each action for debugging

### 4. **Database** ✅
- Prisma migration created and applied
- SQLite database initialized (`dev.sqlite`)
- Schema includes: `Session`, `DailyUsage`, `LeadTimeSetting`

### 5. **Dependencies Updated** ✅
- Added `@vitejs/plugin-react` and `typescript` to devDependencies
- All custom deps included (`@anthropic-ai/sdk`, `@shopify/polaris`, etc.)

### 6. **Environment Setup** ✅
- `.env` file created with detailed instructions for each variable

---

## 🔧 What You Need to Do Next

### **Step 1: Get Shopify App Credentials** (5 min)

1. Go to **[Shopify Partner Dashboard](https://partners.shopify.com)**
2. Click **"Apps and sales channel apps"** → find/create your app `ai-forecast-agent`
3. Go to **Configuration** → scroll to **"Admin API credentials"**
4. Copy `Client ID` and `Client secret` into `.env`:
   ```
   SHOPIFY_API_KEY=<Client ID>
   SHOPIFY_API_SECRET=<Client secret>
   ```

### **Step 2: Get Anthropic Claude API Key** (2 min)

1. Go to **[Anthropic Console](https://console.anthropic.com)**
2. Click **"API Keys"** in the sidebar → **"Create Key"**
3. Copy the key into `.env`:
   ```
   ANTHROPIC_API_KEY=<your_api_key>
   ```

### **Step 3: Start Development Server** (1 min)

Run the Shopify CLI development server:

```bash
npm run dev
```

This will:
1. Compile your Remix app with Vite
2. Start a local tunnel (Cloudflare) — you'll see a URL like `https://abc-123-def.trycloudflare.com`
3. **Copy that URL into `.env`**:
   ```
   SHOPIFY_APP_URL=https://abc-123-def.trycloudflare.com
   ```

### **Step 4: Link to Your Development Store**

When you run `npm run dev`, the Shopify CLI will prompt you:
- **"Which shop are you installing to?"** → Create or select a **development store**
- The app will install automatically into that store

### **Step 5: Access the App**

1. Go to your **Shopify Admin Dashboard** (admin.shopify.com) for your dev store
2. In the left sidebar, find **"Apps and sales channel apps"** → click **"App name"** (ai-forecast-agent)
3. You'll see your dashboard with:
   - Inventory forecast table (currently empty if it's the first install)
   - AI agent chatbox

**First install**: The app automatically backfills historical order data in the background (up to 10 pages). Check the browser console or terminal logs to see progress.

---

## 📋 File Structure Overview

```
app/
├── entry.client.tsx          # Client-side Remix entry (React hydration)
├── entry.server.tsx          # Server-side Remix entry (SSR)
├── root.jsx                  # Root layout (App Bridge + Polaris provider)
├── lib/
│   ├── shopify.server.js     # Shopify app auth setup
│   ├── db.server.js          # Prisma client
│   ├── forecasting.js        # Reorder point logic
│   ├── ai-agent.js           # Claude API integration
│   ├── usage-history.server.js
│   └── backfill.server.js    # Historical data seeding
├── graphql/
│   └── queries.js            # Inventory GraphQL queries
└── routes/
    ├── auth.login.jsx        # OAuth login route
    ├── auth.callback.jsx     # OAuth callback route
    ├── app.jsx               # Protected app layout
    ├── app._index.jsx        # Main dashboard (with backfill trigger)
    ├── api.agent-chat.jsx    # AI agent endpoint
    └── webhooks.orders-updated.jsx

prisma/
├── schema.prisma             # Database schema
└── migrations/

.env                          # Environment variables (UPDATE THIS)
shopify.app.toml             # App metadata (pre-filled)
remix.config.js              # Remix config
vite.config.ts               # Vite build config
package.json                 # Dependencies
```

---

## 🚀 Key Features Wired Up

### **Automatic Backfill on First Install**
- When a merchant installs the app, `app/routes/app._index.jsx` detects zero usage history
- Triggers `backfillUsageHistory()` → pulls last 10 pages of orders
- Populates `DailyUsage` table in the background
- Merchant sees a mature forecast on day one

### **Continuous Webhook Tracking**
- `orders/create` and `orders/updated` webhooks populate `DailyUsage` daily
- Double-counting fixed: checks `financial_status` before recording
- Persists in SQLite database

### **Accurate Forecasting**
- Calculates **average daily usage** from 30-day history
- Computes **reorder point** using lead time
- Shows **days of cover** = current stock / avg daily usage
- Status badge: "reorder now" / "reorder soon" / "healthy" / "no recent sales"

### **AI Agent Integration**
- Merchant asks questions (e.g., "What should I reorder?")
- Uses Claude to analyze the forecast snapshot
- Returns natural language insights

---

## ⚠️ Important Notes

### Token Migration (Jan 1, 2027)
- This app uses **expiring offline access tokens** (60 min lifetime)
- Shopify automatically provides a **refresh token** (90 days)
- Session storage in Prisma handles refresh automatically
- No action needed for new installs; see `app/lib/shopify.server.js` for retrofit guidance

### Production Deployment
- **Database**: Switch from SQLite to PostgreSQL in `.env`:
  ```
  DATABASE_URL="postgresql://user:password@host/dbname"
  ```
- **Backfill**: Move from fire-and-forget to a real job queue (Bull, Inngest, etc.)
- **Security**: Use a secrets manager for `SHOPIFY_API_SECRET` and `ANTHROPIC_API_KEY`

### Testing Webhooks Locally
- `shopify app dev` automatically sets up webhook subscriptions
- Check "Orders" in your dev store — place test orders to trigger webhooks
- Monitor logs: `npm run dev` shows webhook delivery logs

---

## 🐛 Troubleshooting

### **"App not found" when trying to install**
- Make sure you filled in `SHOPIFY_API_KEY` in `.env`
- Verify the app exists in Partner Dashboard
- Restart `npm run dev`

### **No forecast data showing**
- **First install**: Backfill is running in background — wait 30 sec and refresh
- Check browser console or terminal for backfill errors
- Make sure your dev store has orders

### **"Database locked" errors**
- SQLite can have concurrency issues with multiple processes
- Try restarting: `npm run dev`
- For production, use PostgreSQL

### **Webhook not firing**
- Check that `orders/create` and `orders/updated` are subscribed in `shopify.app.toml`
- Place a test order in dev store admin
- Monitor logs for webhook delivery

---

## 📚 Next Steps

1. ✅ Fill in `.env` with Shopify + Anthropic credentials
2. ✅ Run `npm run dev`
3. ✅ Install app into dev store
4. ✅ Place a test order to trigger webhooks
5. ✅ See forecast data populate
6. ✅ Ask the AI agent a question

**Questions?** Check:
- [Shopify App Remix Docs](https://shopify.dev/docs/api/admin-rest/2024-01)
- [Polaris Component Library](https://shopify.dev/docs/api/polaris)
- [Anthropic Claude API Docs](https://docs.anthropic.com/)

---

## Summary of Changes Made

| Step | Status | Details |
|------|--------|---------|
| 1. Scaffold official Remix template | ✅ | Auth routes, app layout, entry files |
| 2. Merge custom files | ✅ | Forecasting, AI agent, usage tracking |
| 3. Fix webhook double-counting | ✅ | Added financial_status + logging checks |
| 4. Wire backfill on first install | ✅ | app._index.jsx triggers if no usage history |
| 5. Setup Prisma | ✅ | Migration created, dev.sqlite initialized |
| 6. Create .env with instructions | ✅ | Detailed comments for each variable |
| 7. Update dependencies | ✅ | Added Vite React plugin, TypeScript |

You're ready to start developing! 🚀
