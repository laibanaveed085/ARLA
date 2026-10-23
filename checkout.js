import { calculateTotals, getDeliveryZone } from "./lib/order-utils.js";
import {
  getCartItems,
  loadCart,
  loadFulfillment,
  loadOrderAddress,
  loadOrderConfig,
  money,
  saveCart,
  clearOrderAddress,
} from "./cart-store.js";

const loaded = loadCart();
const cart = loaded.cart;
const form = document.querySelector("#checkout-form");
const submitButton = document.querySelector("#place-order-button");
const status = document.querySelector("#checkout-status");
const configStatus = document.querySelector("#order-config-status");
const confirmation = document.querySelector("#order-confirmation");
let orderAddress = loadOrderAddress();
let selectedFulfillment = loadFulfillment();
let config = null;
let submitting = false;

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
    !hasItems || !deliveryReady || submitting;
  if (submitting) submitButton.textContent = "Sending order…";
  else if (!config?.orderingEnabled) submitButton.textContent = "Online ordering isn't available";
  else if (config.taxRatePercent == null) submitButton.textContent = "Tax settings aren't configured";
  else if (!hasItems) submitButton.textContent = "Add items to your order";
  else if (!deliveryReady) submitButton.textContent = "Check delivery address and minimum";
  else submitButton.textContent = "Place Order";
}

function renderConfirmation(result) {
  document.querySelector("#confirmation-number").textContent = `Order ${result.orderNumber}`;
  document.querySelector("#confirmation-customer").textContent =
    `${result.customerName} · ${result.phone}`;
  document.querySelector("#confirmation-fulfillment").textContent =
    result.fulfillment === "pickup"
      ? "Pickup in Gaithersburg, Maryland."
      : `Delivery to ${result.address.street}, ${result.address.city}, ${result.address.state} ${result.address.zipCode}. ARLA will confirm the exact address.`;
  const lines = document.querySelector("#confirmation-items");
  lines.replaceChildren();
  for (const item of result.items) {
    const line = document.createElement("li");
    line.textContent = `${item.quantity} × ${item.name} — ${money.format(item.price_cents * item.quantity / 100)}`;
    lines.append(line);
  }
  document.querySelector("#confirmation-prices").textContent =
    `Food ${money.format(result.subtotalCents / 100)} · Delivery ${money.format(result.deliveryFeeCents / 100)} · Tax ${money.format(result.taxCents / 100)}`;
  document.querySelector("#confirmation-total").textContent =
    `Total: ${money.format(result.totalCents / 100)}`;
  document.querySelector("#confirmation-time").textContent = result.requestedTime
    ? `Requested time: ${result.requestedTime} (subject to ARLA confirmation)`
    : "";
  document.querySelector("#confirmation-instructions").textContent = result.instructions
    ? `Special instructions: ${result.instructions}`
    : "";
  document.querySelector("#confirmation-payment").textContent = result.paymentNotice;
  confirmation.hidden = false;
  confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function initialize() {
  try {
    config = await loadOrderConfig();
    if (!config.orderingEnabled) {
      const needs = config.configurationIssues?.join(", ") || "business configuration";
      configStatus.textContent = `Online checkout is not active yet. ARLA still needs to configure: ${needs}.`;
      configStatus.dataset.state = "error";
    } else {
      configStatus.textContent = "Ordering is available. ARLA will confirm your order and payment method.";
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
  const data = new FormData(form);
  const payload = {
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

  submitting = true;
  renderSummary();
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ARLA could not receive this order.");
    for (const id of Object.keys(cart)) delete cart[id];
    const storageError = saveCart(cart);
    const addressStorageError = clearOrderAddress();
    status.textContent = storageError || addressStorageError || "Your order was saved and sent to ARLA.";
    form.reset();
    renderConfirmation(result);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submitting = false;
    renderSummary();
  }
});

initialize();
window.addEventListener("pageshow", () => {
  orderAddress = loadOrderAddress();
  selectedFulfillment = loadFulfillment();
  renderSummary();
});
