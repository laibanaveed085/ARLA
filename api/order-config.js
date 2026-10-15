import { json, methodNotAllowed, publicConfig } from "../lib/server.js";

export default function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    return json(res, 200, publicConfig());
  } catch (error) {
    console.error("Order configuration error:", error.message);
    return json(res, 503, { error: "Online ordering setup is incomplete. Please contact ARLA to order." });
  }
}
