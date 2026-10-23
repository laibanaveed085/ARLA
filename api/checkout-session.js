import { isDeepStrictEqual } from "node:util";
import { calculateTotals } from "../lib/order-utils.js";
import {
  json,
  methodNotAllowed,
  normalizeOrder,
  publicConfig,
  readJsonBody,
  supabaseRequest,
  ValidationError,
} from "../lib/server.js";
import {
  buildCheckoutSessionParams,
  StripeApiError,
  stripeRequest,
} from "../lib/stripe.js";

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function orderMatchesRecord(order, record, totals) {
  const items = order.items.map(({ id, name, priceCents, quantity }) => ({
    id, name, price_cents: priceCents, quantity,
  }));
  return record.customer_name === order.name &&
    record.phone === order.phone &&
    record.email === order.email &&
    record.fulfillment === order.fulfillment &&
    isDeepStrictEqual(record.address, order.address) &&
    record.instructions === order.instructions &&
    record.requested_time === order.requestedTime &&
    isDeepStrictEqual(record.items, items) &&
    record.subtotal_cents === totals.subtotalCents &&
    record.delivery_fee_cents === totals.deliveryFeeCents &&
    record.tax_cents === totals.taxCents &&
    record.total_cents === totals.totalCents;
}

async function findCheckoutOrder(requestId) {
  const rows = await supabaseRequest(
    `/rest/v1/orders?select=*&checkout_request_id=eq.${encodeURIComponent(requestId)}&limit=1`,
  );
  return rows[0] ?? null;
}

async function getExistingSession(record) {
  if (!record.stripe_checkout_session_id) return null;
  const session = await stripeRequest(
    `/checkout/sessions/${encodeURIComponent(record.stripe_checkout_session_id)}`,
  );
  if (session.status === "open" && session.url) return session;
  if (session.status === "complete" && session.payment_status === "paid") {
    throw new ValidationError("This order has already been paid.");
  }
  if (session.status === "complete" && session.payment_status === "unpaid") {
    throw new ValidationError("Payment is still processing. Do not retry payment yet; check your confirmation page shortly.");
  }
  throw new ValidationError("This checkout session has expired. Start a new checkout from your order review.");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const config = publicConfig();
    if (!config.orderingEnabled || !config.stripePaymentsEnabled) {
      return json(res, 503, {
        error: "Stripe test checkout is not configured yet. Please call ARLA to order.",
        configurationIssues: [
          ...config.configurationIssues,
          ...config.paymentConfigurationIssues,
        ],
      });
    }
    if (config.taxRatePercent === null) {
      return json(res, 503, { error: "Tax settings are not configured. Online checkout cannot start." });
    }
    const body = await readJsonBody(req);
    const requestId = body?.checkoutRequestId;
    if (!isUuid(requestId)) throw new ValidationError("Start checkout again to create a secure payment session.");
    const order = normalizeOrder(body);
    const totals = calculateTotals(
      order.items,
      config.taxRatePercent,
      order.deliveryFeeCents,
      config.deliveryTaxable,
    );
    const existing = await findCheckoutOrder(requestId);
    if (existing) {
      if (!orderMatchesRecord(order, existing, totals)) {
        throw new ValidationError("Checkout details changed. Start a new payment attempt.");
      }
      if (existing.payment_status === "paid") throw new ValidationError("This order has already been paid.");
      if (existing.payment_status === "canceled") {
        throw new ValidationError("This checkout session expired. Start a new checkout from your order review.");
      }
      if (existing.payment_status === "failed") {
        throw new ValidationError("The previous payment attempt failed. Start a new checkout from your order review.");
      }
      const existingSession = await getExistingSession(existing);
      return json(res, 200, { checkoutUrl: existingSession.url });
    }

    const record = {
      id: order.id,
      order_number: order.orderNumber,
      customer_name: order.name,
      phone: order.phone,
      email: order.email,
      fulfillment: order.fulfillment,
      address: order.address,
      instructions: order.instructions,
      requested_time: order.requestedTime,
      items: order.items.map(({ id, name, priceCents, quantity }) => ({
        id, name, price_cents: priceCents, quantity,
      })),
      subtotal_cents: totals.subtotalCents,
      delivery_fee_cents: totals.deliveryFeeCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      payment_status: "pending",
      checkout_request_id: requestId,
      status: "Received",
    };
    await supabaseRequest("/rest/v1/orders?on_conflict=checkout_request_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(record),
    });

    const saved = await findCheckoutOrder(requestId);
    if (!saved) throw new Error("Pending order was not saved.");
    if (!orderMatchesRecord(order, saved, totals)) {
      throw new ValidationError("Checkout details changed. Start a new payment attempt.");
    }
    if (saved.payment_status !== "pending") {
      throw new ValidationError("This payment attempt is no longer available. Start a new checkout.");
    }
    if (saved.stripe_checkout_session_id) {
      const existingSession = await getExistingSession(saved);
      return json(res, 200, { checkoutUrl: existingSession.url });
    }

    const checkoutOrder = {
      ...order,
      id: saved.id,
      orderNumber: saved.order_number,
    };
    const { params } = buildCheckoutSessionParams(checkoutOrder, config);
    const session = await stripeRequest("/checkout/sessions", {
      method: "POST",
      params,
      idempotencyKey: `arla-checkout-${requestId}`,
    });
    if (!session.id || !session.url) throw new StripeApiError("Stripe did not return a checkout link.");

    const rows = await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(saved.id)}&payment_status=eq.pending`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          stripe_checkout_session_id: session.id,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!rows.length) throw new Error("Checkout session could not be linked to the pending order.");
    return json(res, 201, { checkoutUrl: session.url });
  } catch (error) {
    if (error instanceof ValidationError) return json(res, 400, { error: error.message });
    console.error("Stripe checkout session creation failed:", error.message);
    return json(res, 503, {
      error: "ARLA could not start secure checkout. Please try again or contact ARLA.",
    });
  }
}
