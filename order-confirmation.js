import { clearOrderAddress, loadCart, money, saveCart } from "./cart-store.js";

const sessionId = new URLSearchParams(location.search).get("session_id") || "";
const heading = document.querySelector("#confirmation-heading");
const message = document.querySelector("#confirmation-message");
const orderNumber = document.querySelector("#confirmation-order-number");
const total = document.querySelector("#confirmation-total");
const fulfillment = document.querySelector("#confirmation-fulfillment");
const checkButton = document.querySelector("#check-payment-button");
const continueLink = document.querySelector("#confirmation-continue");
const retryLink = document.querySelector("#confirmation-retry");
const FORM_STATE_KEY = "arla-checkout-form";
const REQUEST_ID_KEY = "arla-checkout-request-id";
let checking = false;
let confirmed = false;

function showTerminalState(paymentStatus, order) {
  checkButton.hidden = true;
  if (paymentStatus === "paid") {
    heading.textContent = "Thank you — payment confirmed.";
    message.textContent = "Stripe confirmed your payment, and ARLA has received your order.";
    orderNumber.textContent = `Order ${order.orderNumber}`;
    total.textContent = `Paid total: ${money.format(order.totalCents / 100)}`;
    fulfillment.textContent = order.fulfillment === "delivery"
      ? "Delivery details are attached to your order. ARLA will confirm the delivery time."
      : "Pickup in Gaithersburg, Maryland.";
    continueLink.hidden = false;
    confirmed = true;
    const { cart } = loadCart();
    for (const id of Object.keys(cart)) delete cart[id];
    const cleanupIssues = [];
    if (saveCart(cart)) {
      cleanupIssues.push("The saved cart could not be cleared. This order is already paid.");
    }
    const addressCleanupIssue = clearOrderAddress();
    if (addressCleanupIssue) cleanupIssues.push(addressCleanupIssue);
    try {
      sessionStorage.removeItem(FORM_STATE_KEY);
      sessionStorage.removeItem(REQUEST_ID_KEY);
    } catch {
      cleanupIssues.push("This browser could not clear its temporary checkout details.");
    }
    if (cleanupIssues.length) {
      message.textContent = `Payment is confirmed. ${cleanupIssues.join(" ")}`;
    }
    return;
  }

  heading.textContent = paymentStatus === "failed" ? "Payment was not completed." : "Checkout expired.";
  message.textContent = paymentStatus === "failed"
    ? "No paid order was sent to ARLA. You can return to checkout and try again."
    : "This payment session expired before payment was confirmed. Your cart is still available.";
  retryLink.hidden = false;
}

async function checkPayment() {
  if (checking || confirmed) return;
  checking = true;
  checkButton.disabled = true;
  try {
    const response = await fetch(`/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Payment status is temporarily unavailable.");
    if (result.paymentStatus === "paid" || result.paymentStatus === "failed" || result.paymentStatus === "canceled") {
      showTerminalState(result.paymentStatus, result);
    } else {
      heading.textContent = "Payment is still processing.";
      message.textContent = "This page will only confirm your order after Stripe's verified notification reaches ARLA.";
    }
  } catch (error) {
    heading.textContent = "We couldn't check payment yet.";
    message.textContent = error.message;
  } finally {
    checking = false;
    if (!confirmed && retryLink.hidden) checkButton.disabled = false;
  }
}

if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
  heading.textContent = "No Stripe test session was provided.";
  message.textContent = "Open checkout from your ARLA order to check a payment.";
  checkButton.hidden = true;
  retryLink.hidden = false;
} else {
  checkButton.addEventListener("click", checkPayment);
  checkPayment();
  const poll = window.setInterval(() => {
    if (confirmed || !retryLink.hidden) {
      window.clearInterval(poll);
      return;
    }
    checkPayment();
  }, 3000);
  window.setTimeout(() => window.clearInterval(poll), 120000);
}
