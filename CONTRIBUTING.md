# Contributing

Thanks for considering a contribution. A few ground rules:

## Before opening a PR
- Open an issue first for anything beyond a small fix/typo, so we can agree on the approach.
- Keep `app/lib/forecasting.js` pure and deterministic — no side effects, no calls to the AI
  provider from inside it. The AI agent explains numbers this file computes; it never invents them.
- Keep Shopify scopes read-only unless the PR is specifically about a reviewed, approved new
  write feature — new scopes mean a bigger App Store review bar and need discussion first.

## Setup
See the README's "Local setup" section. You'll need your own free Shopify Partner account and
development store — this repo can't provide one.

## Before submitting
- `npm run build` must pass.
- `npm run lint` isn't set up yet (ESLint isn't installed) — once it is, it must pass too.
- No secrets, `.env` files, or database files in your commit. Check `git status` before pushing.
- Describe what you tested and how in the PR description — a development-store screen
  recording or screenshots for anything UI-facing is appreciated.

## Review process
PRs are reviewed and tested against a real development store before merging — this may take a
few days. Security-sensitive changes (auth, webhooks, data handling, scopes) get extra scrutiny.
