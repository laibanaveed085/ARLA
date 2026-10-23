import { json, methodNotAllowed, supabaseRequest } from "../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const sessionId = typeof req.query?.session_id === "string" ? req.query.session_id : "";
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
    return json(res, 400, { error: "A valid test checkout session is required." });
  }
  try {
    const rows = await supabaseRequest(
      `/rest/v1/orders?select=order_number,payment_status,fulfillment,total_cents&stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
    );
    if (!rows.length) return json(res, 404, { error: "Checkout order was not found." });
    return json(res, 200, {
      orderNumber: rows[0].order_number,
      paymentStatus: rows[0].payment_status,
      fulfillment: rows[0].fulfillment,
      totalCents: rows[0].total_cents,
    });
  } catch (error) {
    console.error("Checkout status lookup failed:", error.message);
    return json(res, 503, { error: "Payment status is temporarily unavailable." });
  }
}
