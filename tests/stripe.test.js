import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCheckoutSessionParams } from "../lib/stripe.js";
import { verifyStripeSignature } from "../lib/stripe-webhook.js";

test("builds Checkout line items from server-priced food, delivery, and tax", (t) => {
  const previous = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://www.thearla.com";
  t.after(() => {
    if (previous === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previous;
  });

  const { params, totals } = buildCheckoutSessionParams({
    id: "52cbd03c-8c8c-4c01-bf29-86a15fb5c101",
    orderNumber: "ARLA-20261023-0123456789ABCDEF",
    fulfillment: "delivery",
    email: "guest@example.test",
    deliveryFeeCents: 299,
    items: [{ id: "chicken-biryani", name: "Chicken Biryani", priceCents: 1199, quantity: 2 }],
  }, {
    taxRatePercent: 6.5,
    deliveryTaxable: true,
  });

  assert.equal(params.get("mode"), "payment");
  assert.equal(params.has("payment_method_types[0]"), false);
  assert.equal(params.get("client_reference_id"), "52cbd03c-8c8c-4c01-bf29-86a15fb5c101");
  assert.match(params.get("success_url"), /order-confirmation\.html\?session_id=/);
  assert.equal(params.get("cancel_url"), "https://www.thearla.com/checkout.html?payment=cancelled");
  assert.equal(params.get("customer_email"), "guest@example.test");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "1199");
  assert.equal(params.get("line_items[0][quantity]"), "2");
  assert.equal(params.get("line_items[1][price_data][unit_amount]"), "299");
  assert.equal(params.get("line_items[1][price_data][product_data][name]"), "Delivery");
  assert.equal(params.get("line_items[2][price_data][unit_amount]"), "175");
  assert.equal(params.get("line_items[2][price_data][product_data][name]"), "Sales tax");
  assert.equal(totals.totalCents, 2872);
});

test("verifies Stripe timestamped signatures and rejects tampering or stale events", () => {
  const rawBody = Buffer.from('{"id":"evt_test","type":"checkout.session.completed"}');
  const secret = "whsec_test_signing_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  assert.equal(verifyStripeSignature(rawBody, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(verifyStripeSignature(Buffer.from(`${rawBody} `), `t=${timestamp},v1=${signature}`, secret), false);
  assert.equal(verifyStripeSignature(rawBody, `t=${timestamp - 301},v1=${signature}`, secret), false);
  assert.equal(verifyStripeSignature(rawBody, `t=${timestamp},v1=${signature}`, "wrong-secret"), false);
});

test("rejects live-mode Stripe secret keys", async (t) => {
  const { requireStripeTestKey } = await import("../lib/stripe.js");
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_not_for_tests";
  t.after(() => {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  });
  assert.throws(() => requireStripeTestKey(), /test-mode/);
});

test("locks order storage and webhook processing behind Supabase service role", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202610230001_stripe_checkout.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table public\.orders enable row level security/i);
  assert.match(migration, /revoke all on table public\.orders from public, anon, authenticated/i);
  assert.match(migration, /grant all on table public\.orders to service_role/i);
  assert.match(migration, /revoke all on function public\.process_stripe_payment_event[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.process_stripe_payment_event[\s\S]*?to service_role/i);
});
