import { menu } from "./menu-data.js";

const menuById = new Map(menu.map((item) => [item.id, item]));
const CART_KEY = "arla-cart";
const FULFILLMENT_KEY = "arla-fulfillment";
const ORDER_ADDRESS_KEY = "arla-order-address";
const CHECKOUT_REQUEST_KEY = "arla-checkout-request-id";

export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      throw new Error("Saved cart has an invalid format.");
    }
    const cart = {};
    for (const [id, quantity] of Object.entries(saved)) {
      if (menuById.has(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 20) {
        cart[id] = quantity;
      }
    }
    return { cart, error: "" };
  } catch {
    return {
      cart: {},
      error: "Your saved order could not be restored. You can start a new order on this page.",
    };
  }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    return "";
  } catch {
    return "This browser could not save your order. Keep this page open while ordering.";
  }
}

export function getCartItems(cart) {
  return Object.entries(cart)
    .map(([id, quantity]) => {
      const item = menuById.get(id);
      return item && quantity > 0 ? { ...item, quantity } : null;
    })
    .filter(Boolean);
}

export function loadFulfillment() {
  try {
    const saved = localStorage.getItem(FULFILLMENT_KEY);
    return saved === "delivery" ? "delivery" : "pickup";
  } catch {
    return "pickup";
  }
}

export function saveFulfillment(value) {
  if (!["pickup", "delivery"].includes(value)) return;
  try {
    localStorage.setItem(FULFILLMENT_KEY, value);
  } catch {
    return "This browser could not save your fulfillment choice.";
  }
  return "";
}

export function loadOrderAddress() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_ADDRESS_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return {
      street: typeof saved.street === "string" ? saved.street.slice(0, 200) : "",
      city: typeof saved.city === "string" ? saved.city : "",
      zipCode: typeof saved.zipCode === "string" ? saved.zipCode.slice(0, 5) : "",
    };
  } catch {
    return {};
  }
}

export function saveOrderAddress(address) {
  try {
    localStorage.setItem(ORDER_ADDRESS_KEY, JSON.stringify({
      street: typeof address.street === "string" ? address.street.slice(0, 200) : "",
      city: typeof address.city === "string" ? address.city : "",
      zipCode: typeof address.zipCode === "string" ? address.zipCode.slice(0, 5) : "",
    }));
    return "";
  } catch {
    return "This browser could not save the delivery address. Keep this page open while ordering.";
  }
}

export function clearOrderAddress() {
  try {
    localStorage.removeItem(ORDER_ADDRESS_KEY);
  } catch {
    return "This browser could not clear the saved delivery address.";
  }
  return "";
}

export function clearCheckoutRequestId() {
  try {
    sessionStorage.removeItem(CHECKOUT_REQUEST_KEY);
    return "";
  } catch {
    return "This browser could not reset the payment attempt. Reload checkout before continuing.";
  }
}

export async function loadOrderConfig() {
  const response = await fetch("/api/order-config", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("ARLA ordering information is not available right now.");
  const config = await response.json();
  if (!Array.isArray(config.menu) || !Array.isArray(config.deliveryZones)) {
    throw new Error("ARLA ordering information is incomplete.");
  }
  return config;
}
