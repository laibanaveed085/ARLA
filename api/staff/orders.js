import {
  json,
  methodNotAllowed,
  readJsonBody,
  requireStaff,
  supabaseRequest,
  ValidationError,
} from "../../lib/server.js";
import { ORDER_STATUSES, isValidStatus } from "../../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return methodNotAllowed(res, ["GET", "PATCH"]);
  }
  try {
    await requireStaff(req);
    if (req.method === "GET") {
      const orders = await supabaseRequest(
        "/rest/v1/orders?select=*&order=created_at.desc&limit=100",
      );
      return json(res, 200, { orders, statuses: ORDER_STATUSES });
    }

    const body = await readJsonBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(res, 400, { error: "Choose a valid order and status." });
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !isValidStatus(body.status)) {
      return json(res, 400, { error: "Choose a valid order and status." });
    }
    const rows = await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=id,order_number,status`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: body.status, updated_at: new Date().toISOString() }),
      },
    );
    if (!rows.length) return json(res, 404, { error: "Order not found." });
    return json(res, 200, { order: rows[0] });
  } catch (error) {
    if (error instanceof ValidationError) return json(res, 400, { error: error.message });
    if (error.message.includes("sign-in") || error.message.includes("authorized")) {
      return json(res, 401, { error: error.message });
    }
    console.error("Staff orders request failed:", error.message);
    return json(res, 503, { error: "Order management is temporarily unavailable." });
  }
}
