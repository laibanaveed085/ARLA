import { menu } from "../menu-data.js";

export const DEFAULT_DELIVERY_FEE_CENTS = 299;

export const ORDER_STATUSES = [
  "Received",
  "Preparing",
  "Ready",
  "Out for Delivery",
  "Completed",
];

export function calculateTotals(items, taxRatePercent, deliveryFeeCents = 0, taxDelivery = false) {
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const taxableCents = subtotalCents + (taxDelivery ? deliveryFeeCents : 0);
  const taxCents = Math.round(taxableCents * taxRatePercent / 100);
  return {
    subtotalCents,
    deliveryFeeCents,
    taxCents,
    totalCents: subtotalCents + deliveryFeeCents + taxCents,
  };
}

export function getDeliveryZone(zones, city, zipCode) {
  const normalizedCity = city.trim().toLowerCase();
  const normalizedZip = zipCode.trim();
  return zones.find((zone) =>
    zone.city.toLowerCase() === normalizedCity && zone.zipCodes.includes(normalizedZip),
  ) ?? null;
}

export function parseDeliveryZones(rawValue) {
  if (!rawValue) return [];

  let zones;
  try {
    zones = JSON.parse(rawValue);
  } catch {
    throw new Error("ARLA_DELIVERY_ZONES must be valid JSON.");
  }

  if (!Array.isArray(zones)) {
    throw new Error("ARLA_DELIVERY_ZONES must be a JSON array.");
  }

  const allowedCities = new Set(["Germantown", "Rockville", "Gaithersburg"]);
  const configuredZips = new Set();
  return zones.map((zone) => {
    if (
      !zone || !allowedCities.has(zone.city) ||
      !Array.isArray(zone.zipCodes) || zone.zipCodes.length === 0 ||
      (zone.feeCents !== undefined &&
        (!Number.isSafeInteger(zone.feeCents) || zone.feeCents < 0)) ||
      !Number.isSafeInteger(zone.minimumCents) || zone.minimumCents < 0 ||
      zone.zipCodes.some((zip) => typeof zip !== "string" || !/^\d{5}$/.test(zip))
    ) {
      throw new Error("Each delivery zone needs a supported city, ZIP codes, a nonnegative fee, and a nonnegative minimum.");
    }
    for (const zip of zone.zipCodes) {
      const coverageKey = `${zone.city}:${zip}`;
      if (configuredZips.has(coverageKey)) {
        throw new Error("Each city and ZIP code can appear in only one delivery zone.");
      }
      configuredZips.add(coverageKey);
    }
    return {
      city: zone.city,
      state: "MD",
      zipCodes: [...new Set(zone.zipCodes)],
      feeCents: zone.feeCents,
      minimumCents: zone.minimumCents,
    };
  });
}

export function parseTaxRate(rawValue) {
  if (rawValue === undefined || rawValue.trim() === "") return null;
  const rate = Number(rawValue);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("ARLA_TAX_RATE must be a percentage between 0 and 100.");
  }
  return rate;
}

export function parseDeliveryFee(rawValue) {
  if (rawValue === undefined || rawValue.trim() === "") return DEFAULT_DELIVERY_FEE_CENTS;
  const feeCents = Number(rawValue);
  if (!Number.isSafeInteger(feeCents) || feeCents < 0) {
    throw new Error("ARLA_DELIVERY_FEE_CENTS must be a nonnegative integer in cents.");
  }
  return feeCents;
}

export function getPublicOrderConfig(env) {
  const taxRatePercent = parseTaxRate(env.ARLA_TAX_RATE);
  const deliveryFeeCents = parseDeliveryFee(env.ARLA_DELIVERY_FEE_CENTS);
  const deliveryZones = parseDeliveryZones(env.ARLA_DELIVERY_ZONES);
  const configurationIssues = [];
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) configurationIssues.push("secure order database");
  if (!env.SUPABASE_ANON_KEY || !env.ARLA_STAFF_EMAILS?.split(",").some((email) => email.trim())) {
    configurationIssues.push("authorized staff sign-in");
  }
  if (taxRatePercent === null || !["true", "false"].includes(env.ARLA_TAX_DELIVERY)) {
    configurationIssues.push("sales tax settings");
  }
  const paymentConfigurationIssues = [];
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    paymentConfigurationIssues.push("Stripe test-mode secret key");
  }
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    paymentConfigurationIssues.push("Stripe webhook signing secret");
  }
  try {
    const publicSiteUrl = new URL(env.PUBLIC_SITE_URL);
    if (
      publicSiteUrl.protocol !== "https:" || publicSiteUrl.username || publicSiteUrl.password ||
      publicSiteUrl.pathname !== "/" || publicSiteUrl.search || publicSiteUrl.hash
    ) {
      throw new Error("Invalid public URL.");
    }
  } catch {
    paymentConfigurationIssues.push("HTTPS public site URL");
  }
  return {
    orderingEnabled: configurationIssues.length === 0,
    configurationIssues,
    stripePaymentsEnabled: configurationIssues.length === 0 && paymentConfigurationIssues.length === 0,
    paymentConfigurationIssues,
    menu,
    taxRatePercent,
    deliveryFeeCents,
    deliveryTaxable: env.ARLA_TAX_DELIVERY === "true",
    deliveryZones: deliveryZones.map(({ city, state, zipCodes, feeCents, minimumCents }) => ({
      city,
      state,
      zipCodes,
      feeCents: feeCents ?? deliveryFeeCents,
      minimumCents,
    })),
  };
}
