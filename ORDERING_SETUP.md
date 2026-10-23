# ARLA online ordering setup

## What is implemented

- The homepage shows a small featured selection and sends customers to `/menu.html`; the separate menu page presents popular items, category browsing, and an order basket.
- `/review.html` provides an editable order summary and collects pickup or delivery preference and, when needed, the delivery address. It shows estimated delivery fees and totals before checkout.
- `/checkout.html` carries the selected fulfillment and address forward, collects customer details, and sends orders to the existing API without asking customers to choose pickup or delivery again.
- The shared menu catalog remains the source of item names and prices. Cart contents, fulfillment preference, and the in-progress delivery address persist in browser storage across pages.
- Menu cards include illustrative serving-suggestion photography; these images are not ARLA food photos. Dish descriptions are concise summaries and should be confirmed by ARLA before launch.
- The server recalculates all prices, fees, taxes, delivery eligibility, and minimums. The browser never chooses the amount saved as an order.
- Orders are saved by Vercel serverless functions to Supabase. A confirmation appears only after Supabase accepts the order.
- The staff dashboard is at `/staff.html`. Its API verifies Supabase sign-in and an explicit staff email allowlist before returning or changing order data.
- Delivery can be enabled for specific city/ZIP-code pairs, with separate fee and minimum values. Only configure addresses ARLA has verified as serviceable.
- Delivery costs $2.99 by default. The shared fee is `ARLA_DELIVERY_FEE_CENTS=299`; an individual verified delivery zone can override that with its own `feeCents`.
- Online card payments and email notifications are not implemented. The checkout clearly tells customers that ARLA will confirm the available payment method.

## Required before accepting online orders

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor. The `orders` table has row-level security enabled and direct `anon`/`authenticated` access revoked; only the server-side service role is used by the API.
2. In Supabase Authentication, create an account for each authorized staff member. Set a strong password and configure the exact account email(s) in `ARLA_STAFF_EMAILS`, separated by commas. Staff use `/staff.html`.
3. In the Vercel project settings, add the variables listed in [`.env.example`](.env.example) for the Production environment (and Preview if needed):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from Supabase. The service-role key must remain a private server environment variable; never add it to website JavaScript.
   - `ARLA_STAFF_EMAILS`, the allowlisted staff email addresses.
   - `ARLA_TAX_RATE`, a percentage confirmed for ARLA. Use `0` only if a qualified source confirms no tax applies.
   - `ARLA_TAX_DELIVERY`, set to `true` or `false` only after confirming whether the configured tax applies to the delivery fee. Tax is calculated on the food subtotal and, when set to `true`, the delivery fee.
   - `ARLA_DELIVERY_FEE_CENTS`, normally `299` ($2.99). A delivery zone can provide an optional `feeCents` override.
   - `ARLA_DELIVERY_ZONES`, a JSON array. Each entry has `city`, `zipCodes`, and `minimumCents`; `feeCents` is optional and defaults to the shared $2.99. For example, use a structure such as `[{"city":"Gaithersburg","zipCodes":["REPLACE_WITH_VERIFIED_ZIP"],"minimumCents":0}]` only after replacing the placeholder and setting ARLA's actual minimum. Fees and minimums are integer cents. Supported city names are Germantown, Rockville, and Gaithersburg. An empty array leaves delivery unavailable.
4. Deploy the project through the existing Vercel integration. Verify a real test order appears in `/staff.html`, update its status, then remove the test order before advertising online ordering.

Checkout remains disabled until the database, staff access, tax rate, and taxability setting are all configured. The existing phone and browser-based WhatsApp Web order links remain available during setup.

## Delivery coverage

Delivery is checked against an allowlist of the exact city and five-digit ZIP combinations configured above. Do not add every ZIP in a city by default; first confirm that ARLA can serve those addresses. Fees and minimums are enforced again on the server. The customer must enter a Maryland street address, city, and ZIP. If no configured zone matches, the form asks them to choose pickup or contact ARLA.

## Payments and notifications

No card data is collected or stored, and no payment is processed online. After a saved order, the customer is told that ARLA will confirm the available payment method. To accept online payment, configure a payment provider such as Stripe and add a server-side checkout-session endpoint plus verified payment webhooks before presenting an order as paid. Never put secret payment keys in frontend code.

The staff dashboard refreshes automatically once per minute and has a manual refresh button. Customer email notifications are not configured.

## Local checks

Run `npm test` to verify money calculations, delivery-zone matching, checkout gating, and parity between the displayed menu and server-side catalog. Real order saving and staff authentication can only be verified after connecting the Supabase and Vercel environment settings.
