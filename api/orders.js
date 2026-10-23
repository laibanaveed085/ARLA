import { json, methodNotAllowed } from "../lib/server.js";

export default function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Deprecation", "true");
  return json(res, 410, {
    error: "Direct order submission has been retired. Use Stripe Checkout to submit a food order.",
  });
}
