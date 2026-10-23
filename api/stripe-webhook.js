import { json, methodNotAllowed, readRawBody, supabaseRequest } from "../lib/server.js";
import { verifyStripeSignature } from "../lib/stripe-webhook.js";

export const config = { api: { bodyParser: false } };

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function paymentUpdate(event) {
  const object = event.data?.object;
  if (event.type.startsWith("checkout.session.")) {
    if (!object?.id || !/^cs_test_[A-Za-z0-9]+$/.test(object.id)) return null;
    const orderId = object.metadata?.order_id;
    if (!isUuid(orderId)) return null;
    if (event.type === "checkout.session.completed" && object.payment_status !== "paid") return null;
    const nextState = {
      "checkout.session.completed": "paid",
      "checkout.session.async_payment_succeeded": "paid",
      "checkout.session.async_payment_failed": "failed",
      "checkout.session.expired": "canceled",
    }[event.type];
    if (!nextState) return null;
    return {
      sessionId: object.id,
      orderId,
      paymentIntentId: typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.payment_intent?.id ?? null,
      paymentStatus: nextState,
    };
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    const orderId = object?.metadata?.order_id;
    if (!isUuid(orderId) || !/^pi_[A-Za-z0-9]+$/.test(object?.id ?? "")) return null;
    return {
      sessionId: null,
      orderId,
      paymentIntentId: object.id,
      paymentStatus: event.type === "payment_intent.canceled" ? "canceled" : "failed",
    };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers?.["stripe-signature"];
    if (!verifyStripeSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      return json(res, 400, { error: "Invalid Stripe webhook signature." });
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return json(res, 400, { error: "Invalid Stripe event payload." });
    }
    if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
      return json(res, 400, { error: "Invalid Stripe event payload." });
    }

    const update = paymentUpdate(event);
    if (!update) return json(res, 200, { received: true });
    await supabaseRequest("/rest/v1/rpc/process_stripe_payment_event", {
      method: "POST",
      body: JSON.stringify({
        p_event_id: event.id,
        p_event_type: event.type,
        p_session_id: update.sessionId,
        p_order_id: update.orderId,
        p_payment_intent_id: update.paymentIntentId,
        p_payment_status: update.paymentStatus,
      }),
    });
    return json(res, 200, { received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);
    return json(res, 500, { error: "Stripe event could not be processed." });
  }
}
