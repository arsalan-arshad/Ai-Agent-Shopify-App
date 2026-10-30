# Order webhooks: design notes

How Agent Forecast turns order webhooks into `DailyUsage` rows, and why it is built the way it
is. If you are changing anything in this path, read this first.

Code map:

| File | Role |
|---|---|
| `app/routes/webhooks.orders-updated.jsx` | The handler for `orders/create` and `orders/updated` (both topics point at `/webhooks/orders-updated` in `shopify.app.toml`). |
| `app/lib/order-usage.js` | Pure, deterministic logic: line-item quantity, version resolution, and the plan for what to apply. No I/O. |
| `app/lib/usage-history.server.js` | `recordOrderUsage`: the database transaction that applies a plan. |
| `app/lib/backfill.server.js` | Install-time history import; writes the same `ProcessedOrder` snapshots. |
| `test/order-usage.test.js` | Fixture tests for everything in `order-usage.js`. |
| `scripts/replay-order-webhooks.mjs` | End-to-end replay against a local server and a throwaway database. |

## What the handler does

1. `authenticate.webhook(request)` verifies the HMAC signature before anything else touches
   the payload. A bad signature gets a 401.
2. If the payload has no `id` or `created_at`, it is skipped.
3. A cancelled order (`cancelled_at` set) or one whose `financial_status` is `refunded` or
   `voided` is treated as having **no line items**. Its previously recorded usage is
   subtracted back out by the delta logic below.
4. Otherwise each line item becomes `{ sku, quantity: effectiveQuantity(item) }`.
5. The delivery version is resolved (see "Ordering"), then `recordOrderUsage` runs.

Usage is attributed to the order's **creation date** (UTC day), not to when the webhook fired.

## Idempotency: snapshots and deltas

`orders/updated` fires on nearly any change to an order (address, tags, fulfillment, line
items) and Shopify can redeliver any webhook. Re-adding the full quantities on every delivery
would inflate usage without bound.

`ProcessedOrder` stores, per `(shop, orderId)`, the last `{ sku: quantity }` snapshot that was
recorded. Each delivery is turned into a new snapshot (line items aggregated by SKU; items
with no SKU are ignored; SKUs whose quantity is 0 are dropped), and only the **difference**
against the stored snapshot is applied to `DailyUsage`. Deltas can be negative (a quantity was
reduced, a line was removed). A delivery that changes nothing is a no-op.

A negative delta never creates a negative row: if a `DailyUsage` row does not exist yet, it is
created with `max(delta, 0)`.

## Ordering: why a version check exists

Shopify does not guarantee webhook delivery order, within a topic or across topics (see
[Shopify's webhook docs](https://shopify.dev/docs/apps/build/webhooks), "Ordering event
data"). A delivery for an older version of an order can arrive after a newer one. With a plain
"last delivery wins" rule, two cases ended up permanently wrong:

- an edit (qty 3) arrives first and a stale create (qty 5) second: usage ended at 5, truth is 3;
- a cancellation arrives first and a stale create (qty 5) second: usage ended at 5, truth is 0.

So every delivery carries a **version**, and a delivery older than the version already stored
for that order is skipped:

- **Version source:** the `X-Shopify-Triggered-At` header (millisecond precision), exposed as
  `triggeredAt` by `authenticate.webhook`. If it is missing or unusable, the payload's
  `updated_at` (second precision) is used. `resolveSourceVersion` in `order-usage.js` picks it.
- A version string must look like an ISO timestamp, and one more than 10 minutes in the
  future is ignored (treated as missing), so a bad value cannot block every later real update
  for an order.
- The chosen version is stored in `ProcessedOrder.sourceUpdatedAt`.
- **Older than stored:** `skip_stale`, nothing changes.
- **Equal to stored:** goes through the normal delta path, so a plain duplicate stays a no-op.
- **Newer than stored:** applied, and the stored version advances, even if the line items did
  not change. (Otherwise a delayed older edit could still slip past a version we had seen.)
- **Missing version, or a legacy row with a null `sourceUpdatedAt`:** always applicable, and a
  missing incoming version never moves the stored one backwards.

The planning function is `planOrderUsageUpdate({ previous, incoming })`. It returns
`skip_stale`, `noop` or `apply`, together with the deltas and the next snapshot and version.

## The transaction

`recordOrderUsage` runs one interactive Prisma transaction per delivery:

1. Insert a placeholder `ProcessedOrder` row (`ON CONFLICT DO NOTHING`), so there is always a
   row to lock for a brand-new order.
2. `SELECT ... FOR UPDATE` that row.
3. Plan against the locked row's state.
4. If the plan is `apply`: upsert each `DailyUsage` delta and update the `ProcessedOrder`
   snapshot and version.

Two simultaneous deliveries for the same order are serialized by the row lock, so the second
plans against what the first committed. A row lock was chosen over optimistic compare-and-set
because it needs no retry loop and also covers equal-version deliveries. If anything fails, the
whole transaction (including the placeholder row) rolls back and Shopify retries. The
transaction uses explicit `maxWait` and `timeout` values because the Prisma defaults are tight
when a burst of deliveries queues on one order.

## Quantity: `current_quantity`

In the `orders/updated` payload, `line_items[].quantity` stays at the **original** ordered
quantity, even after the order is edited or partly refunded. `line_items[].current_quantity`
excludes removed and refunded units. This was confirmed on a development store: for one line,
`current_quantity` went 3, then 2 after an edit, then 1 after a partial refund, while
`quantity` stayed 3. (Shopify's GraphQL `LineItem.currentQuantity` is documented the same way;
the REST docs describe `current_quantity` only as quantity minus the removed quantity, so this
rests on observed payloads.)

`effectiveQuantity(item)` returns `current_quantity` (or GraphQL's `currentQuantity`) when it is
a finite, non-negative number, otherwise `quantity` under the same guard, otherwise 0. It
never returns a negative number or NaN. Backfill uses the same function with the GraphQL field.

**Product decision:** refunded and removed units are **not demand**, consistent with how a full
cancel or full refund already behaves. A consequence is that a refund after delivery lowers
recorded demand even though the sale did happen. If you disagree with that, it is a
product-level discussion: open an issue first.

## Known limits

- **Same-version ties are last-arrival-wins.** Two different edits stamped with an identical
  version cannot be told apart. With the millisecond header this is rare; with only
  `updated_at` it needs two edits in the same second.
- **Backfill can overwrite newer webhook state** if it races live traffic. Backfill upserts
  `DailyUsage` and `ProcessedOrder` unconditionally. It only runs when a shop has no tracked
  SKUs yet, which keeps the window small.
- **Backfill does not apply the cancelled/refunded-order rule** that the webhook applies.
- **History before the `current_quantity` change** (PR #26) was recorded with original
  quantities. Those rows are not rewritten; an order is corrected the next time it receives an
  `orders/updated`.
- **Mixed version precision:** the header has millisecond precision, `updated_at` and the
  backfill's GraphQL `updatedAt` have second precision. A delivery whose trigger time lags its
  own `updated_at` by a second or two could in theory be ordered wrongly against a backfilled
  row. Shopify always sends the header, so this is narrow.
- The `X-Shopify-Triggered-At` header is not covered by the HMAC. A replayed signed body with a
  forged header could defeat the stale check for one order in one shop; the future-version cap
  limits the damage of a bad value.

## Running the replay script safely

`scripts/replay-order-webhooks.mjs` sends HMAC-signed `orders/updated` requests to a locally
running server: in-order, edit-then-stale, cancel-then-stale, duplicates, concurrent
deliveries, random permutations, partial refunds, legacy rows. It is **not** part of
`npm test`.

**Use a throwaway local Postgres database and dummy secrets only. Never point this at the
production `DATABASE_URL`, and never use a real `SHOPIFY_API_SECRET`.** The script refuses to
run unless `DATABASE_URL` is on localhost and the database is named
`agent_forecast_replay_test`.

```bash
createdb agent_forecast_replay_test
export DATABASE_URL=postgresql://YOUR_USER@localhost:5432/agent_forecast_replay_test
export SHOPIFY_API_KEY=dummykey SHOPIFY_API_SECRET=dummysecret

npx prisma migrate deploy
npx prisma generate
npm run build

# terminal 1: the server, with the same env vars
PORT=39217 SHOPIFY_APP_URL=http://localhost:39217 npx remix-serve build/server/index.js

# terminal 2: the replay (optionally pass a seed for reproducible random orderings)
BASE_URL=http://localhost:39217 node scripts/replay-order-webhooks.mjs 424242
```

It prints a pass/fail table and exits non-zero on any failure. If the server returns HTTP 500
with an "Unknown argument" Prisma error, run `npx prisma generate` and restart the server.

## Where the fixtures live

`test/order-usage.test.js` holds the fixture tests (`node --test`, no database needed): the
out-of-order cases above, every delivery permutation of create/edit/cancel, duplicates, legacy
null-version rows, ties, SKU removal, SKU-less items, `current_quantity` edits and partial
refunds, version-resolution edge cases, and SKUs that collide with `Object.prototype` keys.
New behavior in `order-usage.js` should come with a fixture test there.
