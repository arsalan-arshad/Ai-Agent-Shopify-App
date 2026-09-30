# Security

This app handles Shopify order data (SKU/quantity/date only — no customer-identifying data is
ever stored, see the compliance webhook handlers in `app/routes/webhooks.*`) and merchants'
own AI provider API keys (encrypted at rest, AES-256-GCM, see `app/lib/crypto.server.js`).

If you find a security issue, please **do not open a public issue**. Email
arsalanarshad.dev@gmail.com instead with details. We'll acknowledge within a few days.
