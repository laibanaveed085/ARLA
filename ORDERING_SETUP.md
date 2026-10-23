# ARLA online ordering setup

## What is implemented

- The homepage shows a small featured selection and sends customers to `/menu.html`; the separate menu page presents popular items, category browsing, and an order basket.
- `/review.html` provides an editable order summary and collects pickup or delivery preference and, when needed, the delivery address. It shows estimated delivery fees and totals before checkout.
- `/checkout.html` carries the selected fulfillment and address forward, collects customer details, and starts Stripe-hosted Checkout without asking customers to choose pickup or delivery again.
- The shared menu catalog remains the source of item names and prices. Cart contents, fulfillment preference, and the in-progress delivery address persist in browser storage across pages.
- Every menu item uses a locally stored photo, including ARLA-provided images for Chicken Pasta, kebabs, Roti, and Fruit Salad. Other reference-photo sources and licenses are linked from the menu. Beef Kebab currently shares the supplied kebab image; replace it with a dedicated beef-kebab photo when available. Dish descriptions are concise summaries and should be confirmed by ARLA before launch.
- The server recalculates all prices, fees, taxes, delivery eligibility, and minimums. The browser never chooses the amount saved as an order.
- Orders are saved by Vercel serverless functions to Supabase. Stripe Checkout Sessions use server-derived menu prices, delivery fees, and the existing configured tax calculation; browser prices are ignored.
- New orders start as `pending` and are not sent to the staff queue as received until a signed Stripe webhook marks them `paid`. The confirmation page polls Supabase-backed payment status; returning from Stripe alone never confirms an order.
- Stripe webhook event IDs and checkout request IDs are unique in Supabase. An atomic database function records each event once and applies payment-state transitions safely on retries.
- Existing orders are retained and migrated as `manual`, so prior staff records remain visible. The former public `POST /api/orders` endpoint now returns `410`; customer orders must use the Stripe Checkout flow.
- The staff dashboard is at `/staff.html`. Its API verifies Supabase sign-in and an explicit staff email allowlist before returning or changing order data.
- Delivery can be enabled for specific city/ZIP-code pairs, with separate fee and minimum values. Only configure addresses ARLA has verified as serviceable.
- Delivery costs $2.99 by default. The shared fee is `ARLA_DELIVERY_FEE_CENTS=299`; an individual verified delivery zone can override that with its own `feeCents`.
- Stripe Checkout is restricted to test mode until ARLA completes the setup below. Customer email notifications are not implemented.

## Required before accepting online orders

1. Apply the storage changes before deploying the Stripe flow. For an existing database, run [`supabase/migrations/202610230001_stripe_checkout.sql`](supabase/migrations/202610230001_stripe_checkout.sql) in the Supabase SQL editor. For a new database, run [`supabase/schema.sql`](supabase/schema.sql). This is an additive change to the existing orders table plus a private `stripe_webhook_events` table and an atomic RPC function; existing orders become `manual`. Keep the orders table RLS enabled and direct `anon`/`authenticated` access revoked.
2. In Supabase Authentication, create an account for each authorized staff member. Set a strong password and configure the exact account email(s) in `ARLA_STAFF_EMAILS`, separated by commas. Staff use `/staff.html`.
3. Create or use a Stripe account in **test mode**. Do not use live keys. Add a test-mode webhook endpoint at `https://www.thearla.com/api/stripe-webhook` for:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`

   Copy the webhook signing secret (`whsec_...`) shown for that test endpoint. Stripe signs the raw webhook body; the Vercel function disables automatic body parsing and verifies the signature and timestamp before changing payment state.
4. In Vercel Project Settings → Environment Variables, configure the existing variables below along with those in [`.env.example`](.env.example) for **Preview** and **Production** as appropriate. Stripe secrets are server-only; do not place them in frontend files or commit them:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from Supabase. The service-role key must remain a private server environment variable; never add it to website JavaScript.
   - `ARLA_STAFF_EMAILS`, the allowlisted staff email addresses.
   - `ARLA_TAX_RATE`, a percentage confirmed for ARLA. Use `0` only if a qualified source confirms no tax applies.
   - `ARLA_TAX_DELIVERY`, set to `true` or `false` only after confirming whether the configured tax applies to the delivery fee. Tax is calculated on the food subtotal and, when set to `true`, the delivery fee.
   - `ARLA_DELIVERY_FEE_CENTS`, normally `299` ($2.99). A delivery zone can provide an optional `feeCents` override.
   - `ARLA_DELIVERY_ZONES`, a JSON array. Each entry has `city`, `zipCodes`, and `minimumCents`; `feeCents` is optional and defaults to the shared $2.99. For example, use a structure such as `[{"city":"Gaithersburg","zipCodes":["REPLACE_WITH_VERIFIED_ZIP"],"minimumCents":0}]` only after replacing the placeholder and setting ARLA's actual minimum. Fees and minimums are integer cents. Supported city names are Germantown, Rockville, and Gaithersburg. An empty array leaves delivery unavailable.
   - `STRIPE_SECRET_KEY`, a test-mode key beginning `sk_test_`. The API rejects live-mode secret keys.
   - `STRIPE_WEBHOOK_SECRET`, the test endpoint signing secret beginning `whsec_`.
   - `PUBLIC_SITE_URL`, the exact public HTTPS origin used for Stripe redirects, such as `https://www.thearla.com`. Use the appropriate HTTPS Vercel Preview origin for preview testing.
5. Deploy through the existing Vercel/GitHub integration. Stripe payments remain unavailable if the database, tax, test-mode key, webhook secret, or public URL is missing. Verify test payments and webhook delivery before enabling the customer flow.

Stripe Checkout remains disabled until the database, staff access, tax rate, taxability setting, Stripe test key, webhook secret, and public HTTPS URL are configured. The existing phone and browser-based WhatsApp Web contact links remain available during setup.

## Delivery coverage

Delivery is checked against an allowlist of the exact city and five-digit ZIP combinations configured above. Do not add every ZIP in a city by default; first confirm that ARLA can serve those addresses. Fees and minimums are enforced again on the server. The customer must enter a Maryland street address, city, and ZIP. If no configured zone matches, the form asks them to choose pickup or contact ARLA.

## Stripe test payments

- The browser sends menu item IDs, quantities, and customer/fulfillment details. The server revalidates them against `menu-data.js` and recalculates food, delivery, tax, and total amounts before creating a Checkout Session.
- The Checkout Session is created through Stripe's API using a server-only `sk_test_...` key. Food, delivery, and the existing server-calculated tax are separate Checkout line items. Stripe Checkout uses the payment methods enabled for the account in the Stripe Dashboard; keep only test-mode methods enabled until ARLA has verified the integration.
- On a Stripe return URL, the confirmation page only reads payment status. It says payment is confirmed only after a signature-verified webhook updates the saved order.
- `payment_intent.payment_failed` marks the attempt failed but allows a later successful payment event for the same open session to transition it to paid. Expired sessions become canceled. Duplicate event deliveries are idempotent.
- The staff queue only returns legacy `manual` records and `paid` Stripe orders. `pending`, `failed`, and `canceled` attempts are not treated as restaurant orders.
- The direct public `POST /api/orders` endpoint is retired to prevent orders bypassing Checkout. Existing stored orders are retained. Continue phone/WhatsApp orders outside the online payment flow.
- No card data is collected or stored by ARLA. Refunds, disputes, and automatic email notifications are not part of this integration; manage test transactions in Stripe Dashboard.

For local webhook testing, start the project with the Vercel CLI, then use Stripe CLI test mode:

```sh
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Use the `whsec_...` value printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET` in local Vercel environment settings. Use Stripe's documented test card numbers in Checkout; do not use real card details. Confirm successful orders appear in `/staff.html` only after the webhook succeeds. Confirm failed and expired sessions do not enter the active staff queue.

The staff dashboard refreshes automatically once per minute and has a manual refresh button. Customer email notifications are not configured.

## Local checks

Run `npm test` to verify money calculations, delivery-zone matching, checkout gating, Stripe Checkout line-item generation, webhook signature handling, and the paid-order staff filter. Real Checkout and webhook integration require the Stripe test credentials, Supabase migration, and Vercel environment settings described above.
