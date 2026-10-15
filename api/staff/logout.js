import { json, methodNotAllowed, requireStaff } from "../../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const rawUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const response = await fetch(`${rawUrl.replace(/\/$/, "")}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: req.headers.authorization },
    });
    if (!response.ok) return json(res, 503, { error: "Could not end the staff session at this time." });
    return json(res, 200, { success: true });
  } catch (error) {
    console.error("Staff sign-out failed:", error.message);
    return json(res, 503, { error: "Staff sign-out could not be completed." });
  }
}
