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

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const config = publicConfig();
    if (!config.orderingEnabled) {
      return json(res, 503, { error: "Online order submission is not configured yet. Please call ARLA to order." });
    }
    const order = normalizeOrder(await readJsonBody(req));
    if (config.taxRatePercent === null) {
      return json(res, 503, { error: "Tax settings are not configured. Online orders cannot be submitted yet." });
    }
    const totals = calculateTotals(
      order.items,
      config.taxRatePercent,
      order.deliveryFeeCents,
      config.deliveryTaxable,
    );
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
      status: "Received",
    };
    await supabaseRequest("/rest/v1/orders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(record),
    });
    return json(res, 201, {
      orderNumber: order.orderNumber,
      items: record.items,
      customerName: order.name,
      phone: order.phone,
      fulfillment: order.fulfillment,
      address: order.address,
      requestedTime: order.requestedTime,
      instructions: order.instructions,
      subtotalCents: totals.subtotalCents,
      deliveryFeeCents: totals.deliveryFeeCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      paymentNotice: "Online payment is not configured. ARLA will confirm the available payment method.",
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return json(res, 400, { error: error.message });
    }
    console.error("Order submission failed:", error.message);
    return json(res, 503, { error: "ARLA could not receive this order. Please call or WhatsApp to order." });
  }
}
