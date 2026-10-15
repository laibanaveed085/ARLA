import { randomBytes, randomUUID } from "node:crypto";
import { menu } from "../menu-data.js";
import {
  getDeliveryZone,
  getPublicOrderConfig,
  ORDER_STATUSES,
} from "./order-utils.js";

export class ValidationError extends Error {}

export function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return json(res, 405, { error: "Method not allowed." });
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

export async function readJsonBody(req, maxBytes = 16000) {
  if (req.body !== undefined) {
    const body = readBody(req);
    if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) throw new ValidationError("Request body is too large.");
    return body;
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new ValidationError("Request body is too large.");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

export function publicConfig() {
  return getPublicOrderConfig(process.env);
}

export function requireBackend() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
  if (!url || !serviceKey) throw new Error("Order storage is not configured.");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export async function supabaseRequest(path, options = {}) {
  const { url, serviceKey } = requireBackend();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Order database returned an invalid response.");
    }
  }
  if (!response.ok) {
    console.error("Supabase request failed:", response.status, data?.message ?? data?.error);
    throw new Error("The order service could not complete the request.");
  }
  return data;
}

export function normalizeOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Order details are required.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
  const requestedTime = typeof body.requestedTime === "string" ? body.requestedTime.trim() : "";
  const fulfillment = body.fulfillment;
  if (name.length < 2 || name.length > 100) throw new ValidationError("Enter your full name.");
  const phoneDigits = phone.replace(/\D/g, "");
  if (!/^[+()\d\s.-]{7,25}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    throw new ValidationError("Enter a valid phone number.");
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ValidationError("Enter a valid email address or leave it blank.");
  }
  if (!["pickup", "delivery"].includes(fulfillment)) throw new ValidationError("Choose pickup or delivery.");
  if (instructions.length > 1000) throw new ValidationError("Special instructions must be 1,000 characters or fewer.");
  if (requestedTime.length > 100) throw new ValidationError("Requested time must be 100 characters or fewer.");
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > menu.length) {
    throw new ValidationError("Your cart must contain at least one valid menu item.");
  }

  const menuById = new Map(menu.map((item) => [item.id, item]));
  const seen = new Set();
  const items = body.items.map((entry) => {
    const item = menuById.get(entry?.id);
    if (!item || seen.has(item.id)) throw new ValidationError("Your cart contains an invalid menu item.");
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 20) {
      throw new ValidationError("Each item quantity must be between 1 and 20.");
    }
    seen.add(item.id);
    return { id: item.id, name: item.name, priceCents: item.priceCents, quantity: entry.quantity };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  if (subtotalCents <= 0 || subtotalCents > 1000000) throw new ValidationError("Order amount is outside the allowed range.");

  let address = null;
  if (fulfillment === "delivery") {
    const street = typeof body.address?.street === "string" ? body.address.street.trim() : "";
    const city = typeof body.address?.city === "string" ? body.address.city.trim() : "";
    const state = typeof body.address?.state === "string" ? body.address.state.trim().toUpperCase() : "";
    const zipCode = typeof body.address?.zipCode === "string" ? body.address.zipCode.trim() : "";
    if (street.length < 5 || street.length > 200 || !/^\d{5}$/.test(zipCode) || state !== "MD") {
      throw new ValidationError("Enter a complete Maryland delivery address and ZIP code.");
    }
    const zones = publicConfig().deliveryZones;
    const zone = getDeliveryZone(zones, city, zipCode);
    if (!zone) {
      throw new ValidationError("That address is outside ARLA's currently configured delivery area. Please choose pickup.");
    }
    if (subtotalCents < zone.minimumCents) {
      throw new ValidationError(`Delivery requires a minimum food order of $${(zone.minimumCents / 100).toFixed(2)} for this area.`);
    }
    address = { street, city: zone.city, state: "MD", zipCode };
  }

  return {
    id: randomUUID(),
    orderNumber: `ARLA-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(8).toString("hex").toUpperCase()}`,
    name,
    phone,
    email: email || null,
    fulfillment,
    address,
    instructions: instructions || null,
    requestedTime: requestedTime || null,
    items,
    subtotalCents,
    deliveryFeeCents: fulfillment === "delivery"
      ? getDeliveryZone(publicConfig().deliveryZones, address.city, address.zipCode).feeCents
      : 0,
  };
}

export async function requireStaff(req) {
  const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  const { SUPABASE_URL: rawUrl, SUPABASE_ANON_KEY: anonKey } = process.env;
  const allowedEmails = (process.env.ARLA_STAFF_EMAILS ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!token || !rawUrl || !anonKey || allowedEmails.length === 0) {
    throw new Error("Staff access is not configured.");
  }
  const response = await fetch(`${rawUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Staff sign-in has expired. Please sign in again.");
  const user = await response.json();
  if (!allowedEmails.includes(user.email?.toLowerCase())) {
    throw new Error("This account is not authorized to manage ARLA orders.");
  }
  return user;
}

export function isValidStatus(status) {
  return ORDER_STATUSES.includes(status);
}

export { getPublicOrderConfig, ORDER_STATUSES };
