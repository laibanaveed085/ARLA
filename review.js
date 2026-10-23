import { calculateTotals, getDeliveryZone } from "./lib/order-utils.js";
import {
  getCartItems,
  clearCheckoutRequestId,
  loadCart,
  loadFulfillment,
  loadOrderAddress,
  loadOrderConfig,
  money,
  saveCart,
  saveFulfillment,
  saveOrderAddress,
} from "./cart-store.js";

const loadedCart = loadCart();
const cart = loadedCart.cart;
const list = document.querySelector("#review-items");
const empty = document.querySelector("#review-empty");
const checkoutLink = document.querySelector("#checkout-link");
const status = document.querySelector("#review-status");
const addressFields = document.querySelector("#review-address-fields");
const addressInputs = {
  street: document.querySelector("#review-street"),
  city: document.querySelector("#review-city"),
  zipCode: document.querySelector("#review-zip"),
};
let config = null;
let fulfillment = loadFulfillment();
let address = loadOrderAddress();

if (loadedCart.error) status.textContent = loadedCart.error;
addressInputs.street.value = address.street;
addressInputs.city.value = address.city;
addressInputs.zipCode.value = address.zipCode;

function control(label, ariaLabel, action, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  button.addEventListener("click", action);
  return button;
}

function persistCartChange(message) {
  const resetError = clearCheckoutRequestId();
  const saveError = saveCart(cart);
  status.textContent = [saveError || message, resetError].filter(Boolean).join(" ");
}

function setQuantity(item, change) {
  const next = (cart[item.id] || 0) + change;
  if (next <= 0) delete cart[item.id];
  else cart[item.id] = Math.min(20, next);
  persistCartChange(`${item.name} ${next <= 0 ? "removed from" : "updated in"} your order.`);
  render();
}

function selectedZone() {
  if (fulfillment !== "delivery" || !config) return null;
  return getDeliveryZone(config.deliveryZones, address.city, address.zipCode);
}

function deliveryIsReady(subtotalCents, zone) {
  return fulfillment === "pickup" || Boolean(
    address.street.trim() && address.city && /^\d{5}$/.test(address.zipCode) &&
    config?.deliveryZones?.length && zone && subtotalCents >= zone.minimumCents,
  );
}

function renderFulfillment(subtotalCents, zone) {
  addressFields.hidden = fulfillment !== "delivery";
  for (const input of document.querySelectorAll('input[name="fulfillment"]')) {
    input.checked = input.value === fulfillment;
  }

  const pickupDetails = document.querySelector("#pickup-details");
  const deliveryStatus = document.querySelector("#review-delivery-status");
  pickupDetails.hidden = fulfillment !== "pickup";
  deliveryStatus.hidden = fulfillment !== "delivery";
  deliveryStatus.dataset.state = "";
  for (const input of Object.values(addressInputs)) input.required = fulfillment === "delivery";

  if (fulfillment !== "delivery") {
    deliveryStatus.textContent = "";
  } else if (!config?.deliveryZones?.length) {
    deliveryStatus.textContent = "Delivery is not configured yet. Please call ARLA or choose pickup.";
    deliveryStatus.dataset.state = "error";
  } else if (!address.street.trim() || !address.city || !/^\d{5}$/.test(address.zipCode)) {
    deliveryStatus.textContent = "Enter your street address, city, and 5-digit ZIP code to check delivery availability.";
  } else if (!zone) {
    deliveryStatus.textContent = "This address is outside ARLA's configured delivery area. Please choose pickup or call ARLA.";
    deliveryStatus.dataset.state = "error";
  } else if (subtotalCents < zone.minimumCents) {
    deliveryStatus.textContent = `Delivery for ${zone.city} requires a food subtotal of at least ${money.format(zone.minimumCents / 100)}.`;
    deliveryStatus.dataset.state = "error";
  } else {
    deliveryStatus.textContent = `${zone.city}, ${zone.state} is in ARLA's delivery area.`;
  }
}

function render() {
  const items = getCartItems(cart);
  list.replaceChildren();
  empty.hidden = items.length > 0;

  for (const item of items) {
    const row = document.createElement("li");
    row.className = "review-item";
    const copy = document.createElement("div");
    copy.className = "review-item-copy";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const unit = document.createElement("span");
    unit.textContent = `${money.format(item.priceCents / 100)} each`;
    copy.append(title, unit);

    const quantity = document.createElement("div");
    quantity.className = "review-quantity";
    quantity.append(
      control("−", `Decrease ${item.name} quantity`, () => setQuantity(item, -1)),
      quantityLabel(item.quantity),
      control("+", `Increase ${item.name} quantity`, () => setQuantity(item, 1), item.quantity >= 20),
    );

    const lineTotal = document.createElement("strong");
    lineTotal.className = "review-line-total";
    lineTotal.textContent = money.format(item.priceCents * item.quantity / 100);
    const remove = control("Remove", `Remove ${item.name} from your order`, () => {
      delete cart[item.id];
      persistCartChange(`${item.name} removed from your order.`);
      render();
    });
    remove.className = "remove-item";
    row.append(copy, quantity, lineTotal, remove);
    list.append(row);
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const zone = selectedZone();
  const deliveryFeeCents = fulfillment === "pickup"
    ? 0
    : (zone?.feeCents ?? config?.deliveryFeeCents ?? 0);
  document.querySelector("#review-subtotal").textContent = money.format(subtotalCents / 100);
  document.querySelector("#review-delivery-fee").textContent =
    fulfillment === "delivery" && !config ? "Not available" : money.format(deliveryFeeCents / 100);
  const taxElement = document.querySelector("#review-tax");
  const totalElement = document.querySelector("#review-total");
  const totalLabel = document.querySelector("#review-total-label");
  const note = document.querySelector("#review-total-note");
  if (config?.taxRatePercent != null) {
    const totals = calculateTotals(items, config.taxRatePercent, deliveryFeeCents, config.deliveryTaxable);
    taxElement.textContent = money.format(totals.taxCents / 100);
    totalElement.textContent = money.format(totals.totalCents / 100);
    totalLabel.textContent = "Estimated total";
    note.textContent = fulfillment === "delivery"
      ? "Delivery is subject to address coverage and the delivery minimum shown above."
      : "Final totals will be confirmed at checkout.";
  } else {
    taxElement.textContent = "Not configured";
    totalElement.textContent = money.format((subtotalCents + deliveryFeeCents) / 100);
    totalLabel.textContent = "Estimated total before tax";
    note.textContent = "Tax will be confirmed at checkout.";
  }
  note.hidden = items.length === 0;
  renderFulfillment(subtotalCents, zone);
  checkoutLink.hidden = items.length === 0 || !deliveryIsReady(subtotalCents, zone);
}

function quantityLabel(quantity) {
  const label = document.createElement("span");
  label.textContent = `Qty ${quantity}`;
  label.setAttribute("aria-label", `Quantity ${quantity}`);
  return label;
}

for (const input of document.querySelectorAll('input[name="fulfillment"]')) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    fulfillment = input.value;
    clearCheckoutRequestId();
    status.textContent = saveFulfillment(fulfillment);
    render();
  });
}

function updateAddress() {
  address = {
    street: addressInputs.street.value,
    city: addressInputs.city.value,
    zipCode: addressInputs.zipCode.value,
  };
  clearCheckoutRequestId();
  status.textContent = saveOrderAddress(address);
  render();
}
for (const input of Object.values(addressInputs)) {
  input.addEventListener("input", updateAddress);
  input.addEventListener("change", updateAddress);
}

try {
  config = await loadOrderConfig();
} catch (error) {
  status.textContent = error.message;
}
render();
