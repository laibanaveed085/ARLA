import { calculateTotals } from "./order-utils.js";

export class StripeApiError extends Error {}

export function requireStripeTestKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) {
    throw new Error("Stripe test-mode payments are not configured.");
  }
  return key;
}

export function requirePublicSiteUrl() {
  let url;
  try {
    url = new URL(process.env.PUBLIC_SITE_URL);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be configured as an HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("PUBLIC_SITE_URL must be a clean HTTPS URL.");
  }
  return url.origin;
}

export function buildCheckoutSessionParams(order, config) {
  const siteUrl = requirePublicSiteUrl();
  const totals = calculateTotals(
    order.items,
    config.taxRatePercent,
    order.deliveryFeeCents,
    config.deliveryTaxable,
  );
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${siteUrl}/order-confirmation.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${siteUrl}/checkout.html?payment=cancelled`);
  params.set("client_reference_id", order.id);
  params.set("metadata[order_id]", order.id);
  params.set("metadata[order_number]", order.orderNumber);
  params.set("metadata[fulfillment]", order.fulfillment);
  params.set("payment_intent_data[metadata][order_id]", order.id);

  let index = 0;
  for (const item of order.items) {
    const prefix = `line_items[${index}]`;
    params.set(`${prefix}[price_data][currency]`, "usd");
    params.set(`${prefix}[price_data][unit_amount]`, String(item.priceCents));
    params.set(`${prefix}[price_data][product_data][name]`, item.name);
    params.set(`${prefix}[quantity]`, String(item.quantity));
    index += 1;
  }

  if (totals.deliveryFeeCents > 0) {
    const prefix = `line_items[${index}]`;
    params.set(`${prefix}[price_data][currency]`, "usd");
    params.set(`${prefix}[price_data][unit_amount]`, String(totals.deliveryFeeCents));
    params.set(`${prefix}[price_data][product_data][name]`, "Delivery");
    params.set(`${prefix}[quantity]`, "1");
    index += 1;
  }

  if (totals.taxCents > 0) {
    const prefix = `line_items[${index}]`;
    params.set(`${prefix}[price_data][currency]`, "usd");
    params.set(`${prefix}[price_data][unit_amount]`, String(totals.taxCents));
    params.set(`${prefix}[price_data][product_data][name]`, "Sales tax");
    params.set(`${prefix}[quantity]`, "1");
  }

  if (order.email) params.set("customer_email", order.email);
  return { params, totals };
}

export async function stripeRequest(path, { method = "GET", params, idempotencyKey } = {}) {
  const key = requireStripeTestKey();
  const headers = { Authorization: `Bearer ${key}` };
  const options = { method, headers };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = params.toString();
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new StripeApiError("Stripe returned an invalid response.");
  }
  if (!response.ok) {
    console.error("Stripe API request failed:", response.status, body?.error?.type);
    throw new StripeApiError("Stripe could not start checkout. Please try again.");
  }
  return body;
}
