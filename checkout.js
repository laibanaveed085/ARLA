import { calculateTotals, getDeliveryZone } from "./lib/order-utils.js";
import {
  getCartItems,
  loadCart,
  loadFulfillment,
  loadOrderAddress,
  loadOrderConfig,
  money,
  clearCheckoutRequestId,
} from "./cart-store.js";

const loaded = loadCart();
const cart = loaded.cart;
const form = document.querySelector("#checkout-form");
const submitButton = document.querySelector("#place-order-button");
const status = document.querySelector("#checkout-status");
const configStatus = document.querySelector("#order-config-status");
let orderAddress = loadOrderAddress();
let selectedFulfillment = loadFulfillment();
let config = null;
let submitting = false;
const requestIdKey = "arla-checkout-request-id";
const formStateKey = "arla-checkout-form";

if (loaded.error) status.textContent = loaded.error;

function fulfillment() {
  return selectedFulfillment;
}

function zoneForAddress() {
  if (!config || fulfillment() !== "delivery") return null;
  return getDeliveryZone(config.deliveryZones, orderAddress.city, orderAddress.zipCode);
}

function renderSummary() {
  const items = getCartItems(cart);
  const list = document.querySelector("#checkout-items");
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    row.className = "checkout-summary-row";
    const label = document.createElement("span");
    label.textContent = `${item.quantity} × ${item.name}`;
    const amount = document.createElement("strong");
    amount.textContent = money.format(item.priceCents * item.quantity / 100);
    row.append(label, amount);
    list.append(row);
  }
  document.querySelector("#checkout-empty").hidden = items.length > 0;

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const zone = zoneForAddress();
  const deliveryFeeCents = fulfillment() === "delivery"
    ? (zone?.feeCents ?? config?.deliveryFeeCents ?? 299)
    : 0;
  document.querySelector("#checkout-subtotal").textContent = money.format(subtotalCents / 100);
  document.querySelector("#checkout-delivery").textContent = money.format(deliveryFeeCents / 100);
  const note = document.querySelector("#checkout-total-note");
  if (config?.taxRatePercent != null) {
    const totals = calculateTotals(items, config.taxRatePercent, deliveryFeeCents, config.deliveryTaxable);
    document.querySelector("#checkout-tax").textContent = money.format(totals.taxCents / 100);
    document.querySelector("#checkout-total").textContent = money.format(totals.totalCents / 100);
    note.hidden = true;
  } else {
    document.querySelector("#checkout-tax").textContent = "Not configured";
    document.querySelector("#checkout-total").textContent = money.format((subtotalCents + deliveryFeeCents) / 100);
    note.textContent = "Tax is not configured, so ARLA cannot accept online orders yet.";
    note.hidden = false;
  }
  updateDelivery(subtotalCents, zone);
  updateSubmit(items.length > 0, subtotalCents, zone);
}

function updateDelivery(subtotalCents, zone) {
  const delivery = fulfillment() === "delivery";
  const label = document.querySelector("#checkout-fulfillment-label");
  const details = document.querySelector("#checkout-fulfillment-details");
  const deliveryStatus = document.querySelector("#checkout-fulfillment-status");
  label.textContent = delivery ? "Delivery" : "Pickup";
  details.textContent = delivery
    ? [orderAddress.street, orderAddress.city, "MD", orderAddress.zipCode].filter(Boolean).join(", ")
    : "Pickup in Gaithersburg, Maryland.";
  deliveryStatus.hidden = !delivery;
  deliveryStatus.dataset.state = "";
  if (!delivery) {
    deliveryStatus.textContent = "";
  } else if (!config?.deliveryZones?.length) {
    deliveryStatus.textContent = "Delivery is not configured yet. Please call ARLA or choose pickup.";
    deliveryStatus.dataset.state = "error";
  } else if (!orderAddress.street.trim() || !orderAddress.city || !/^\d{5}$/.test(orderAddress.zipCode)) {
    deliveryStatus.textContent = "Return to order review to complete the delivery address.";
    deliveryStatus.dataset.state = "";
  } else if (!zone) {
    deliveryStatus.textContent = "This address is outside ARLA's configured delivery area. Please choose pickup or call ARLA.";
    deliveryStatus.dataset.state = "error";
  } else if (subtotalCents < zone.minimumCents) {
    deliveryStatus.textContent = `Delivery for ${zone.city} requires a food subtotal of at least ${money.format(zone.minimumCents / 100)}.`;
    deliveryStatus.dataset.state = "error";
  } else {
    deliveryStatus.textContent = `${zone.city}, ${zone.state} is in ARLA's delivery area. ARLA will confirm the exact address.`;
    deliveryStatus.dataset.state = "";
  }
}

function updateSubmit(hasItems, subtotalCents, zone) {
  const isDelivery = fulfillment() === "delivery";
  const deliveryReady = !isDelivery || Boolean(
    orderAddress.street.trim() && zone && subtotalCents >= zone.minimumCents,
  );
  submitButton.disabled = !config?.orderingEnabled || config.taxRatePercent == null ||
    !config?.stripePaymentsEnabled || !hasItems || !deliveryReady || submitting;
  if (submitting) submitButton.textContent = "Sending order…";
  else if (!config?.orderingEnabled) submitButton.textContent = "Online ordering isn't available";
  else if (!config?.stripePaymentsEnabled) submitButton.textContent = "Stripe test checkout isn't configured";
  else if (config.taxRatePercent == null) submitButton.textContent = "Tax settings aren't configured";
  else if (!hasItems) submitButton.textContent = "Add items to your order";
  else if (!deliveryReady) submitButton.textContent = "Check delivery address and minimum";
  else submitButton.textContent = "Continue to secure payment";
}

function restoreForm() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(formStateKey) || "{}");
    for (const name of ["name", "phone", "email", "requestedTime", "instructions"]) {
      if (typeof saved[name] === "string") form.elements[name].value = saved[name];
    }
  } catch {
    status.textContent = "Saved checkout details could not be restored. Please re-enter your contact details.";
  }
}

function persistForm() {
  const data = new FormData(form);
  try {
    sessionStorage.setItem(formStateKey, JSON.stringify({
      name: data.get("name"),
      phone: data.get("phone"),
      email: data.get("email"),
      requestedTime: data.get("requestedTime"),
      instructions: data.get("instructions"),
    }));
  } catch {
    status.textContent = "This browser could not preserve checkout details if you return from Stripe.";
  }
}

function getCheckoutRequestId() {
  try {
    const existing = sessionStorage.getItem(requestIdKey);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const requestId = crypto.randomUUID();
    sessionStorage.setItem(requestIdKey, requestId);
    return requestId;
  } catch {
    throw new Error("This browser could not safely start checkout. Please enable session storage and try again.");
  }
}

async function initialize() {
  restoreForm();
  if (new URLSearchParams(location.search).get("payment") === "cancelled") {
    status.textContent = "Payment was not completed. Your order is saved; you can return to Stripe Checkout to try again.";
  }
  try {
    config = await loadOrderConfig();
    if (!config.orderingEnabled || !config.stripePaymentsEnabled) {
      const needs = [
        ...(config.configurationIssues || []),
        ...(config.paymentConfigurationIssues || []),
      ].join(", ") || "business configuration";
      configStatus.textContent = `Stripe test checkout is not active yet. ARLA still needs to configure: ${needs}.`;
      configStatus.dataset.state = "error";
    } else {
      configStatus.textContent = "Secure Stripe test checkout is ready. Your order is sent to ARLA after payment is confirmed.";
      configStatus.dataset.state = "";
    }
  } catch (error) {
    configStatus.textContent = `${error.message} Please call or message ARLA to order.`;
    configStatus.dataset.state = "error";
  }
  renderSummary();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity() || submitButton.disabled || submitting) return;
  let payload;
  try {
    const data = new FormData(form);
    payload = {
      checkoutRequestId: getCheckoutRequestId(),
      name: data.get("name"),
      phone: data.get("phone"),
      email: data.get("email"),
      fulfillment: fulfillment(),
      instructions: data.get("instructions"),
      requestedTime: data.get("requestedTime"),
      items: Object.entries(cart).map(([id, quantity]) => ({ id, quantity })),
    };
    if (payload.fulfillment === "delivery") {
      payload.address = {
        street: orderAddress.street,
        city: orderAddress.city,
        state: "MD",
        zipCode: orderAddress.zipCode,
      };
    }
  } catch (error) {
    status.textContent = error.message;
    return;
  }

  submitting = true;
  renderSummary();
  try {
    persistForm();
    const response = await fetch("/api/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      if (/details changed|failed|expired|no longer available/i.test(result.error || "")) {
        const resetError = clearCheckoutRequestId();
        if (resetError) throw new Error(`${result.error} ${resetError}`);
      }
      throw new Error(result.error || "ARLA could not start secure checkout.");
    }
    const checkoutUrl = new URL(result.checkoutUrl);
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
      throw new Error("ARLA received an invalid Stripe checkout link.");
    }
    status.textContent = "Redirecting to secure Stripe Checkout…";
    location.assign(checkoutUrl.toString());
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submitting = false;
    renderSummary();
  }
});

form.addEventListener("input", () => {
  clearCheckoutRequestId();
  persistForm();
});

initialize();
window.addEventListener("pageshow", () => {
  orderAddress = loadOrderAddress();
  selectedFulfillment = loadFulfillment();
  renderSummary();
});
