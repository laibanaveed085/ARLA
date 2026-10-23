import { ORDER_STATUSES } from "./lib/order-utils.js";

const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const ordersMessage = document.querySelector("#orders-message");
const orderList = document.querySelector("#staff-order-list");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
let refreshTimer = null;

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.dataset.state = isError ? "error" : "";
}

function getToken() {
  return sessionStorage.getItem("arla-staff-access-token");
}

function setSignedIn(email) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  document.querySelector("#staff-identity").textContent = `Signed in as ${email}`;
  loadOrders();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadOrders(true), 60000);
}

function showLogin(message = "") {
  clearInterval(refreshTimer);
  dashboardView.hidden = true;
  loginView.hidden = false;
  orderList.replaceChildren();
  setMessage(loginMessage, message, Boolean(message));
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      sessionStorage.removeItem("arla-staff-access-token");
      showLogin(result.error || "Please sign in again.");
    }
    throw new Error(result.error || "The staff request could not be completed.");
  }
  return result;
}

function appendLine(parent, label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, document.createTextNode(value));
  parent.append(row);
}

function buildOrderCard(order) {
  const card = document.createElement("article");
  card.className = "staff-order-card";

  const top = document.createElement("div");
  top.className = "order-card-top";
  const title = document.createElement("h2");
  title.textContent = order.order_number;
  const topRight = document.createElement("div");
  const status = document.createElement("span");
  status.className = "order-status-label";
  status.textContent = order.status;
  const payment = document.createElement("span");
  payment.className = "payment-status-label";
  payment.textContent = order.payment_status === "paid" ? "Paid · Stripe" : "Manual / legacy";
  const time = document.createElement("time");
  const created = new Date(order.created_at);
  time.dateTime = created.toISOString();
  time.textContent = created.toLocaleString();
  topRight.append(status, payment, time);
  top.append(title, topRight);
  card.append(top);

  const details = document.createElement("div");
  details.className = "order-details";
  appendLine(details, "Customer", order.customer_name);
  appendLine(details, "Phone", order.phone);
  if (order.email) appendLine(details, "Email", order.email);
  appendLine(details, "Fulfillment", order.fulfillment === "pickup" ? "Pickup" : "Delivery");
  if (order.address) {
    appendLine(details, "Delivery address", `${order.address.street}, ${order.address.city}, ${order.address.state} ${order.address.zipCode}`);
  }
  if (order.requested_time) appendLine(details, "Requested time", `${order.requested_time} (needs confirmation)`);
  if (order.instructions) appendLine(details, "Instructions", order.instructions);
  const itemList = document.createElement("ul");
  itemList.className = "order-items";
  for (const item of order.items) {
    const line = document.createElement("li");
    line.textContent = `${item.quantity} × ${item.name} — ${money.format(item.price_cents * item.quantity / 100)}`;
    itemList.append(line);
  }
  details.append(itemList);
  card.append(details);

  const totals = document.createElement("div");
  totals.className = "order-total";
  for (const [label, cents] of [
    ["Food subtotal", order.subtotal_cents],
    ["Delivery", order.delivery_fee_cents],
    ["Tax", order.tax_cents],
    ["Total", order.total_cents],
  ]) {
    const line = document.createElement("div");
    if (label === "Total") line.className = "grand-total";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("strong");
    valueSpan.textContent = money.format(cents / 100);
    line.append(labelSpan, valueSpan);
    totals.append(line);
  }
  card.append(totals);

  const statusForm = document.createElement("form");
  statusForm.className = "status-form";
  const select = document.createElement("select");
  select.className = "status-select";
  select.setAttribute("aria-label", `Status for order ${order.order_number}`);
  for (const optionStatus of ORDER_STATUSES) {
    const option = document.createElement("option");
    option.value = optionStatus;
    option.textContent = optionStatus;
    option.selected = optionStatus === order.status;
    select.append(option);
  }
  const update = document.createElement("button");
  update.type = "submit";
  update.className = "staff-button";
  update.textContent = "Update status";
  statusForm.append(select, update);
  statusForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    update.disabled = true;
    try {
      await apiRequest("/api/staff/orders", {
        method: "PATCH",
        body: JSON.stringify({ id: order.id, status: select.value }),
      });
      setMessage(ordersMessage, `${order.order_number} updated to ${select.value}.`);
      await loadOrders(true);
    } catch (error) {
      setMessage(ordersMessage, error.message, true);
      update.disabled = false;
    }
  });
  card.append(statusForm);
  return card;
}

async function loadOrders(quiet = false) {
  if (!getToken()) return showLogin();
  if (!quiet) setMessage(ordersMessage, "Loading orders…");
  try {
    const result = await apiRequest("/api/staff/orders");
    orderList.replaceChildren();
    if (result.orders.length === 0) {
      setMessage(ordersMessage, "No orders have been received yet.");
      return;
    }
    for (const order of result.orders) orderList.append(buildOrderCard(order));
    if (!quiet) setMessage(ordersMessage, `${result.orders.length} most recent order(s).`);
  } catch (error) {
    if (getToken()) setMessage(ordersMessage, error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  setMessage(loginMessage, "Signing in…");
  try {
    const response = await fetch("/api/staff/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: loginForm.elements.email.value,
        password: loginForm.elements.password.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in failed.");
    sessionStorage.setItem("arla-staff-access-token", result.accessToken);
    loginForm.reset();
    setSignedIn(result.email);
  } catch (error) {
    setMessage(loginMessage, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#refresh-orders").addEventListener("click", () => loadOrders());
document.querySelector("#sign-out").addEventListener("click", async () => {
  let remoteSignOutFailed = false;
  try {
    await apiRequest("/api/staff/logout", { method: "POST" });
  } catch {
    remoteSignOutFailed = true;
  }
  sessionStorage.removeItem("arla-staff-access-token");
  showLogin(remoteSignOutFailed
    ? "This browser signed out, but remote session revocation could not be confirmed."
    : "You have signed out.");
});

const existingToken = getToken();
if (existingToken) setSignedIn("authorized staff");
