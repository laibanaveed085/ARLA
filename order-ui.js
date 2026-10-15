import { menu } from "./menu-data.js";
import { calculateTotals, getDeliveryZone } from "./lib/order-utils.js";

const menuById = new Map(menu.map((item) => [item.id, item]));
const cart = {};
const cartList = document.querySelector("#cart-list");
const cartStatus = document.querySelector("#cart-status");
const cartEmpty = document.querySelector("#cart-empty");
const form = document.querySelector("#checkout-form");
const deliveryFields = document.querySelector("#delivery-fields");
const deliveryStatus = document.querySelector("#delivery-status");
const orderConfigStatus = document.querySelector("#order-config-status");
const placeOrderButton = document.querySelector("#place-order-button");
const confirmation = document.querySelector("#order-confirmation");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
let config = null;
let storageAvailable = true;
let submitting = false;

function setCartMessage(message) {
  cartStatus.textContent = message;
}

function readSavedCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("arla-cart") || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      throw new Error("Saved cart is invalid.");
    }
    for (const [id, quantity] of Object.entries(saved)) {
      if (menuById.has(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 20) {
        cart[id] = quantity;
      }
    }
  } catch {
    storageAvailable = false;
    setCartMessage("This browser could not restore a saved cart. Your current selections will remain until you leave this page.");
  }
}

function saveCart() {
  if (!storageAvailable) return;
  try {
    localStorage.setItem("arla-cart", JSON.stringify(cart));
  } catch {
    storageAvailable = false;
    setCartMessage("Your cart could not be saved by this browser. Keep this page open while ordering.");
  }
}

function addMenuActions() {
  for (const row of document.querySelectorAll("[data-order-item]")) {
    const item = menuById.get(row.dataset.orderItem);
    if (!item) continue;
    const controls = document.createElement("span");
    controls.className = "menu-item-controls";
    controls.dataset.menuControls = item.id;
    row.append(controls);
  }
  renderMenuControls();
}

function renderMenuControls() {
  for (const rowControls of document.querySelectorAll("[data-menu-controls]")) {
    const item = menuById.get(rowControls.dataset.menuControls);
    const quantity = cart[item.id] || 0;
    rowControls.replaceChildren();

    if (quantity === 0) {
      const addButton = document.createElement("button");
      addButton.className = "menu-add-button";
      addButton.type = "button";
      addButton.textContent = "Add to order";
      addButton.setAttribute("aria-label", `Add ${item.name} to your order`);
      addButton.addEventListener("click", () => changeQuantity(item.id, 1));
      rowControls.append(addButton);
      continue;
    }

    const stepper = document.createElement("span");
    stepper.className = "menu-quantity-control";
    const decreaseButton = document.createElement("button");
    decreaseButton.type = "button";
    decreaseButton.textContent = "−";
    decreaseButton.setAttribute("aria-label", `Decrease ${item.name} quantity`);
    decreaseButton.addEventListener("click", () => changeQuantity(item.id, -1));
    const quantityValue = document.createElement("span");
    quantityValue.className = "menu-quantity-value";
    quantityValue.textContent = String(quantity);
    quantityValue.setAttribute("aria-label", `${quantity} ${item.name} in order`);
    const increaseButton = document.createElement("button");
    increaseButton.type = "button";
    increaseButton.textContent = "+";
    increaseButton.disabled = quantity >= 20;
    increaseButton.setAttribute("aria-label", `Increase ${item.name} quantity`);
    increaseButton.addEventListener("click", () => changeQuantity(item.id, 1));
    stepper.append(decreaseButton, quantityValue, increaseButton);
    rowControls.append(stepper);
  }
}

function selectedFulfillment() {
  return form.elements.fulfillment.value;
}

function selectedZone() {
  if (!config || selectedFulfillment() !== "delivery") return null;
  return getDeliveryZone(
    config.deliveryZones,
    form.elements.city.value,
    form.elements.zipCode.value,
  );
}

function renderCart() {
  renderMenuControls();
  cartList.replaceChildren();
  let count = 0;
  const items = [];
  for (const [id, quantity] of Object.entries(cart)) {
    const item = menuById.get(id);
    if (!item || quantity < 1) continue;
    count += quantity;
    items.push({ ...item, quantity });

    const row = document.createElement("li");
    row.className = "cart-row";
    const name = document.createElement("span");
    name.className = "cart-row-name";
    name.textContent = item.name;
    const total = document.createElement("span");
    total.className = "cart-row-total";
    total.textContent = money.format(item.priceCents * quantity / 100);
    const controls = document.createElement("div");
    controls.className = "cart-row-controls";

    const decrement = document.createElement("button");
    decrement.type = "button";
    decrement.textContent = "−";
    decrement.setAttribute("aria-label", `Decrease ${item.name} quantity`);
    decrement.addEventListener("click", () => changeQuantity(id, -1));
    const quantityText = document.createElement("span");
    quantityText.textContent = String(quantity);
    quantityText.setAttribute("aria-label", `Quantity ${quantity}`);
    const increment = document.createElement("button");
    increment.type = "button";
    increment.textContent = "+";
    increment.setAttribute("aria-label", `Increase ${item.name} quantity`);
    increment.disabled = quantity >= 20;
    increment.addEventListener("click", () => changeQuantity(id, 1));
    const remove = document.createElement("button");
    remove.className = "remove-item";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.name} from cart`);
    remove.addEventListener("click", () => {
      delete cart[id];
      saveCart();
      setCartMessage(`${item.name} removed from your cart.`);
      renderCart();
    });
    controls.append(decrement, quantityText, increment, remove);
    row.append(name, total, controls);
    cartList.append(row);
  }

  document.querySelector("#cart-count").textContent = `(${count} ${count === 1 ? "item" : "items"})`;
  document.querySelector("#menu-cart-link").textContent =
    `View your order (${count} ${count === 1 ? "item" : "items"})`;
  cartEmpty.hidden = items.length !== 0;
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const zone = selectedZone();
  const deliveryFeeCents = selectedFulfillment() === "delivery"
    ? (zone?.feeCents ?? config?.deliveryFeeCents ?? 299)
    : 0;
  document.querySelector("#cart-subtotal").textContent = money.format(subtotalCents / 100);
  document.querySelector("#cart-delivery").textContent = money.format(deliveryFeeCents / 100);

  if (config?.taxRatePercent !== null && config?.taxRatePercent !== undefined) {
    const totals = calculateTotals(
      items,
      config.taxRatePercent,
      deliveryFeeCents,
      config.deliveryTaxable,
    );
    document.querySelector("#cart-tax").textContent = money.format(totals.taxCents / 100);
    document.querySelector("#cart-total").textContent = money.format(totals.totalCents / 100);
  } else {
    document.querySelector("#cart-tax").textContent = "Not configured";
    document.querySelector("#cart-total").textContent = "Not configured";
  }

  updateDeliveryStatus(subtotalCents, zone);
  updateSubmitState(items.length > 0, zone, subtotalCents);
}

function changeQuantity(id, change) {
  const nextQuantity = (cart[id] || 0) + change;
  if (nextQuantity < 1) delete cart[id];
  else cart[id] = Math.min(20, nextQuantity);
  saveCart();
  const item = menuById.get(id);
  setCartMessage(nextQuantity < 1
    ? `${item.name} removed from your order.`
    : `${item.name} quantity: ${Math.min(nextQuantity, 20)}.`);
  renderCart();
}

function updateDeliveryStatus(subtotalCents, zone) {
  const isDelivery = selectedFulfillment() === "delivery";
  deliveryFields.hidden = !isDelivery;
  for (const field of deliveryFields.querySelectorAll("input:not([type=hidden]), select")) {
    field.disabled = !isDelivery;
    field.required = isDelivery;
  }
  if (!isDelivery) {
    deliveryStatus.textContent = "Pickup in Gaithersburg, Maryland.";
    deliveryStatus.dataset.state = "";
    return;
  }
  if (!config?.deliveryZones?.length) {
    deliveryStatus.textContent = "Delivery is not configured yet. Please call ARLA or choose pickup.";
    deliveryStatus.dataset.state = "error";
  } else if (!form.elements.city.value || !form.elements.zipCode.value) {
    deliveryStatus.textContent = "Enter your city and ZIP code to check the configured delivery area.";
    deliveryStatus.dataset.state = "";
  } else if (!zone) {
    deliveryStatus.textContent = "That address is outside ARLA's currently configured delivery area. Please choose pickup or call ARLA.";
    deliveryStatus.dataset.state = "error";
  } else if (subtotalCents < zone.minimumCents) {
    deliveryStatus.textContent = `Delivery for ${zone.city} requires a food subtotal of at least ${money.format(zone.minimumCents / 100)}.`;
    deliveryStatus.dataset.state = "error";
  } else {
    deliveryStatus.textContent = `ZIP code matches ARLA's configured ${zone.city}, ${zone.state} delivery area. ARLA will confirm the exact address. Delivery fee: ${money.format(zone.feeCents / 100)}.`;
    deliveryStatus.dataset.state = "";
  }
}

function updateSubmitState(hasItems, zone, subtotalCents) {
  const isDelivery = selectedFulfillment() === "delivery";
  const deliveryReady = !isDelivery || Boolean(zone && subtotalCents >= zone.minimumCents);
  const enabled = Boolean(config?.orderingEnabled && config.taxRatePercent !== null &&
    hasItems && deliveryReady && !submitting);
  placeOrderButton.disabled = !enabled;
  if (submitting) placeOrderButton.textContent = "Sending order…";
  else if (!config?.orderingEnabled) placeOrderButton.textContent = "Online orders are not configured yet";
  else if (isDelivery && !deliveryReady) placeOrderButton.textContent = "Check delivery address and minimum";
  else placeOrderButton.textContent = "Place order";
}

function showConfirmation(result) {
  document.querySelector("#confirmation-number").textContent = result.orderNumber;
  document.querySelector("#confirmation-customer").textContent =
    `Customer: ${result.customerName} · ${result.phone}`;
  document.querySelector("#confirmation-fulfillment").textContent =
    result.fulfillment === "pickup"
      ? "Pickup in Gaithersburg, Maryland."
      : `Delivery requested to ${result.address.street}, ${result.address.city}, ${result.address.state} ${result.address.zipCode}. ARLA will confirm the exact address.`;
  const confirmationItems = document.querySelector("#confirmation-items");
  confirmationItems.replaceChildren();
  for (const item of result.items) {
    const line = document.createElement("li");
    line.textContent = `${item.quantity} × ${item.name} — ${money.format(item.price_cents * item.quantity / 100)}`;
    confirmationItems.append(line);
  }
  document.querySelector("#confirmation-prices").textContent =
    `Food subtotal ${money.format(result.subtotalCents / 100)} · ` +
    `Delivery ${money.format(result.deliveryFeeCents / 100)} · ` +
    `Tax ${money.format(result.taxCents / 100)}`;
  document.querySelector("#confirmation-total").textContent =
    `Total: ${money.format(result.totalCents / 100)}`;
  document.querySelector("#confirmation-time").textContent = result.requestedTime
    ? `Requested time (subject to ARLA confirmation): ${result.requestedTime}`
    : "";
  document.querySelector("#confirmation-instructions").textContent = result.instructions
    ? `Special instructions: ${result.instructions}`
    : "";
  document.querySelector("#confirmation-payment").textContent = result.paymentNotice;
  confirmation.hidden = false;
  confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/order-config", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Ordering setup is not available on this website yet.");
    config = await response.json();
    if (!Array.isArray(config.menu) || !Array.isArray(config.deliveryZones)) {
      throw new Error("The online ordering configuration is incomplete.");
    }
    if (!config.orderingEnabled) {
      const needs = config.configurationIssues?.join(", ") || "business configuration";
      orderConfigStatus.textContent = `Online checkout is not active yet. ARLA still needs to configure: ${needs}.`;
      orderConfigStatus.dataset.state = "error";
    } else {
      orderConfigStatus.textContent = "Online order submission is ready. Delivery is offered only to addresses in ARLA's configured coverage zones.";
      orderConfigStatus.dataset.state = "";
    }
  } catch (error) {
    config = null;
    orderConfigStatus.textContent = `${error.message} Please use the call or WhatsApp options above.`;
    orderConfigStatus.dataset.state = "error";
  }
  renderCart();
}

form.addEventListener("change", renderCart);
form.elements.city.addEventListener("input", renderCart);
form.elements.zipCode.addEventListener("input", renderCart);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !config?.orderingEnabled || submitting) return;
  const formData = new FormData(form);
  const payload = {
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    fulfillment: formData.get("fulfillment"),
    instructions: formData.get("instructions"),
    requestedTime: formData.get("requestedTime"),
    items: Object.entries(cart).map(([id, quantity]) => ({ id, quantity })),
  };
  if (payload.fulfillment === "delivery") {
    payload.address = {
      street: formData.get("street"),
      city: formData.get("city"),
      state: "MD",
      zipCode: formData.get("zipCode"),
    };
  }

  submitting = true;
  updateSubmitState(Object.keys(cart).length > 0, selectedZone(), 0);
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ARLA could not receive the order.");
    for (const id of Object.keys(cart)) delete cart[id];
    saveCart();
    setCartMessage("Your order was saved and sent to ARLA.");
    confirmation.hidden = true;
    form.reset();
    showConfirmation(result);
  } catch (error) {
    setCartMessage(error.message);
  } finally {
    submitting = false;
    renderCart();
  }
});

readSavedCart();
addMenuActions();
renderCart();
loadConfig();
