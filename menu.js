import { menu } from "./menu-data.js";
import {
  getCartItems,
  loadCart,
  money,
  saveCart,
} from "./cart-store.js";

const cartState = loadCart();
const cart = cartState.cart;
const status = document.querySelector("#menu-status");
const featuredGrid = document.querySelector("#featured-menu-grid");
const categoryNav = document.querySelector("#category-nav");
const menuGrid = document.querySelector("#full-menu-grid");
const reviewLinks = document.querySelectorAll("[data-review-order]");
const basketCount = document.querySelector("#basket-count");
const basketSubtotal = document.querySelector("#basket-subtotal");
const basketBar = document.querySelector("#basket-bar");

if (cartState.error) status.textContent = cartState.error;

function imageUrl(item) {
  return `https://images.unsplash.com/${item.image}?auto=format&fit=crop&w=720&q=80`;
}

function makeProductCard(item, featured = false) {
  const card = document.createElement("article");
  card.className = featured ? "product-card product-card-featured" : "product-card";
  const image = document.createElement("img");
  image.className = "product-image";
  image.src = imageUrl(item);
  image.alt = `Illustrative serving suggestion for ${item.name}`;
  image.width = 720;
  image.height = 480;
  image.loading = featured ? "eager" : "lazy";
  image.decoding = "async";

  const details = document.createElement("div");
  details.className = "product-card-details";
  const name = document.createElement("h3");
  name.textContent = item.name;
  const description = document.createElement("p");
  description.textContent = item.description;
  const footer = document.createElement("div");
  footer.className = "product-card-footer";
  const price = document.createElement("strong");
  price.className = "product-price";
  price.textContent = money.format(item.priceCents / 100);
  const controls = document.createElement("span");
  controls.className = "product-controls";
  controls.dataset.productControls = item.id;
  footer.append(price, controls);
  details.append(name, description, footer);
  card.append(image, details);
  renderControls(item, controls);
  return card;
}

function makeButton(label, ariaLabel, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-add-button";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function renderControls(item, host) {
  host.replaceChildren();
  const quantity = cart[item.id] || 0;
  if (!quantity) {
    host.append(makeButton("+ Add", `Add ${item.name} to your order`, () => changeQuantity(item.id, 1)));
    return;
  }

  const stepper = document.createElement("span");
  stepper.className = "menu-quantity-control";
  const value = document.createElement("span");
  value.className = "menu-quantity-value";
  value.textContent = String(quantity);
  value.setAttribute("aria-label", `${quantity} ${item.name} in order`);
  stepper.append(
    makeButton("−", `Decrease ${item.name} quantity`, () => changeQuantity(item.id, -1)),
    value,
    makeButton("+", `Increase ${item.name} quantity`, () => changeQuantity(item.id, 1), quantity >= 20),
  );
  host.append(stepper);
}

function renderFeatured() {
  featuredGrid.replaceChildren();
  const featuredIds = ["chicken-biryani", "saag-paneer", "chicken-pasta", "chai"];
  for (const item of menu.filter((entry) => featuredIds.includes(entry.id))) {
    featuredGrid.append(makeProductCard(item, true));
  }
}

function categoryId(category) {
  return `category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;
}

function renderFullMenu() {
  categoryNav.replaceChildren();
  menuGrid.replaceChildren();
  const categories = new Map();
  for (const item of menu) {
    if (!categories.has(item.category)) categories.set(item.category, []);
    categories.get(item.category).push(item);
  }

  for (const [category, items] of categories) {
    const sectionId = categoryId(category);
    const jump = document.createElement("a");
    jump.href = `#${sectionId}`;
    jump.textContent = category;
    categoryNav.append(jump);

    const section = document.createElement("section");
    section.className = "menu-category-section";
    section.id = sectionId;
    section.setAttribute("aria-labelledby", `${sectionId}-title`);
    const heading = document.createElement("div");
    heading.className = "menu-category-heading";
    const title = document.createElement("h3");
    title.id = `${sectionId}-title`;
    title.textContent = category;
    const count = document.createElement("span");
    count.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
    heading.append(title, count);
    const cards = document.createElement("div");
    cards.className = "product-grid";
    for (const item of items) cards.append(makeProductCard(item));
    section.append(heading, cards);
    menuGrid.append(section);
  }
}

function renderBasket() {
  const items = getCartItems(cart);
  const quantity = items.reduce((total, item) => total + item.quantity, 0);
  const subtotalCents = items.reduce((total, item) => total + item.priceCents * item.quantity, 0);
  basketCount.textContent = `${quantity} ${quantity === 1 ? "item" : "items"}`;
  basketSubtotal.textContent = money.format(subtotalCents / 100);
  basketBar.hidden = quantity === 0;
  for (const link of reviewLinks) {
    link.textContent = quantity
      ? `Review Your Order · ${quantity} ${quantity === 1 ? "item" : "items"}`
      : "Review Your Order";
  }
}

function changeQuantity(id, delta) {
  const next = (cart[id] || 0) + delta;
  if (next <= 0) delete cart[id];
  else cart[id] = Math.min(20, next);
  const item = menu.find((entry) => entry.id === id);
  status.textContent = saveCart(cart) || `${item.name} ${next <= 0 ? "removed from" : "updated in"} your order.`;
  for (const host of document.querySelectorAll(`[data-product-controls="${id}"]`)) {
    renderControls(item, host);
  }
  renderBasket();
}

renderFeatured();
renderFullMenu();
renderBasket();
