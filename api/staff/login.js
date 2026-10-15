import { json, methodNotAllowed, readJsonBody, ValidationError } from "../../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(res, 400, { error: "Enter your staff email and password." });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const allowedEmails = (process.env.ARLA_STAFF_EMAILS ?? "")
      .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    const { SUPABASE_URL: rawUrl, SUPABASE_ANON_KEY: anonKey } = process.env;
    if (!rawUrl || !anonKey || allowedEmails.length === 0) {
      return json(res, 503, { error: "Staff sign-in is not configured." });
    }
    if (!allowedEmails.includes(email)) return json(res, 403, { error: "This account is not authorized." });
    if (!email || password.length < 1 || password.length > 200) {
      return json(res, 400, { error: "Enter your staff email and password." });
    }

    const response = await fetch(`${rawUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) return json(res, 401, { error: "Sign-in failed. Check your credentials and try again." });
    const session = await response.json();
    return json(res, 200, {
      accessToken: session.access_token,
      expiresIn: session.expires_in,
      email: session.user.email,
    });
  } catch (error) {
    if (error instanceof ValidationError) return json(res, 400, { error: error.message });
    console.error("Staff sign-in failed:", error.message);
    return json(res, 503, { error: "Staff sign-in could not be completed." });
  }
}
