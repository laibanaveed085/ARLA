import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { menu } from "../menu-data.js";
import {
  calculateTotals,
  getDeliveryZone,
  getPublicOrderConfig,
  parseDeliveryFee,
  parseDeliveryZones,
} from "../lib/order-utils.js";

test("calculates item subtotal, tax, delivery, and total in integer cents", () => {
  const result = calculateTotals([
    { priceCents: 1199, quantity: 2 },
    { priceCents: 299, quantity: 1 },
  ], 6.5, 250, true);

  assert.deepEqual(result, {
    subtotalCents: 2697,
    deliveryFeeCents: 250,
    taxCents: 192,
    totalCents: 3139,
  });
});

test("taxes the food subtotal only when delivery is configured as nontaxable", () => {
  const result = calculateTotals([{ priceCents: 1000, quantity: 1 }], 5, 400, false);
  assert.deepEqual(result, {
    subtotalCents: 1000,
    deliveryFeeCents: 400,
    taxCents: 50,
    totalCents: 1450,
  });
});

test("matches a delivery zone by both configured city and ZIP", () => {
  const zones = [{
    city: "Rockville",
    zipCodes: ["20850"],
    feeCents: 0,
    minimumCents: 0,
  }];

  assert.equal(getDeliveryZone(zones, "Rockville", "20850"), zones[0]);
  assert.equal(getDeliveryZone(zones, "Rockville", "20851"), null);
  assert.equal(getDeliveryZone(zones, "Germantown", "20850"), null);
});

test("rejects delivery zones with unverified cities, ZIPs, or invalid fees", () => {
  assert.throws(() => parseDeliveryZones('[{"city":"Somewhere","zipCodes":["12345"],"feeCents":0,"minimumCents":0}]'));
  assert.throws(() => parseDeliveryZones('[{"city":"Rockville","zipCodes":["1234"],"feeCents":0,"minimumCents":0}]'));
  assert.throws(() => parseDeliveryZones('[{"city":"Rockville","zipCodes":["20850"],"feeCents":-1,"minimumCents":0}]'));
  assert.throws(() => parseDeliveryZones('[{"city":"Rockville","zipCodes":["20850"],"feeCents":0,"minimumCents":0},{"city":"Rockville","zipCodes":["20850"],"feeCents":100,"minimumCents":0}]'));
});

test("uses the requested $2.99 delivery fee by default and supports zone overrides", () => {
  assert.equal(parseDeliveryFee(undefined), 299);
  assert.equal(parseDeliveryFee("299"), 299);
  assert.throws(() => parseDeliveryFee("-1"));
  assert.throws(() => parseDeliveryFee("2.99"));

  const config = getPublicOrderConfig({
    ARLA_DELIVERY_ZONES: '[{"city":"Gaithersburg","zipCodes":["20878"],"minimumCents":0}]',
  });
  assert.equal(config.deliveryFeeCents, 299);
  assert.equal(config.deliveryZones[0].feeCents, 299);
});

test("does not enable checkout until backend, staff, and tax configuration exist", () => {
  const incomplete = getPublicOrderConfig({});
  assert.equal(incomplete.orderingEnabled, false);
  assert.ok(incomplete.configurationIssues.includes("secure order database"));
  assert.ok(incomplete.configurationIssues.includes("sales tax settings"));

  const complete = getPublicOrderConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "public-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
    ARLA_STAFF_EMAILS: "staff@example.test",
    ARLA_TAX_RATE: "0",
    ARLA_TAX_DELIVERY: "false",
    ARLA_DELIVERY_ZONES: "[]",
  });
  assert.equal(complete.orderingEnabled, true);
  assert.equal(complete.taxRatePercent, 0);
});

test("the homepage keeps only a featured menu preview and routes ordering separately", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const featured = [...html.matchAll(/<article class="featured-card">([\s\S]*?)<\/article>/g)];
  assert.equal(featured.length, 4);
  assert.match(html, /href="menu\.html">Ready to Order\?/);
  assert.doesNotMatch(html, /data-order-item=|id="checkout-form"|id="cart-list"/);

  const featuredPrices = new Map(featured.map(([, markup]) => {
    const name = markup.match(/<h3>([^<]+)<\/h3>/)?.[1];
    const price = markup.match(/\$(\d+)\.(\d{2})/);
    assert.ok(name);
    assert.ok(price, `featured price exists for ${name}`);
    return [name, Number(price[1]) * 100 + Number(price[2])];
  }));
  for (const item of menu.filter(({ id }) =>
    ["chicken-biryani", "saag-paneer", "chicken-pasta", "chai"].includes(id))) {
    assert.equal(featuredPrices.get(item.name), item.priceCents, item.name);
  }
});

test("the ordering menu uses the complete catalog with images, descriptions, and categories", async () => {
  const html = await readFile(new URL("../menu.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../menu.js", import.meta.url), "utf8");
  assert.match(html, /id="featured-menu-grid"/);
  assert.match(html, /id="full-menu-grid"/);
  assert.match(html, /id="category-nav"/);
  assert.doesNotMatch(html, /class="ordering-hero"|Welcome to ARLA|Good food,/);
  assert.doesNotMatch(html, /name="fulfillment"/);
  assert.match(script, /import \{ menu \} from "\.\/menu-data\.js"/);
  assert.match(script, /item\.description/);
  assert.match(script, /item\.image/);
  assert.match(script, /data-product-controls/);
  assert.equal(menu.length, 24);
  assert.ok(menu.every((item) => item.category && item.description && item.image));
  assert.equal(new Set(menu.map(({ image }) => image)).size, menu.length);
});

test("the cart persists across menu, review, and checkout routes", async () => {
  const store = await readFile(new URL("../cart-store.js", import.meta.url), "utf8");
  const menuPage = await readFile(new URL("../menu.html", import.meta.url), "utf8");
  const reviewPage = await readFile(new URL("../review.html", import.meta.url), "utf8");
  const checkoutPage = await readFile(new URL("../checkout.html", import.meta.url), "utf8");
  const reviewScript = await readFile(new URL("../review.js", import.meta.url), "utf8");
  const checkoutScript = await readFile(new URL("../checkout.js", import.meta.url), "utf8");

  assert.match(store, /localStorage\.getItem\(CART_KEY\)/);
  assert.match(store, /localStorage\.setItem\(CART_KEY/);
  assert.match(store, /loadFulfillment/);
  assert.match(store, /loadOrderAddress/);
  assert.match(store, /saveOrderAddress/);
  assert.match(menuPage, /data-review-order/);
  assert.match(reviewPage, /id="review-items"/);
  assert.match(reviewPage, /id="checkout-link"/);
  assert.match(reviewPage, /name="fulfillment"/);
  assert.match(reviewPage, /id="review-address-fields"/);
  assert.match(reviewScript, /getDeliveryZone/);
  assert.match(reviewScript, /calculateTotals/);
  assert.match(reviewScript, /remove-item/);
  assert.match(checkoutPage, /id="checkout-form"/);
  assert.doesNotMatch(checkoutPage, /name="fulfillment"/);
  assert.match(checkoutPage, /id="checkout-fulfillment-details"/);
  assert.match(checkoutPage, /id="place-order-button"/);
  assert.match(checkoutScript, /fetch\("\/api\/orders"/);
  assert.match(checkoutScript, /loadOrderAddress/);
  assert.match(checkoutScript, /fulfillment:\s*fulfillment\(\)/);
  assert.match(checkoutScript, /street:\s*orderAddress\.street/);
  assert.match(checkoutScript, /city:\s*orderAddress\.city/);
  assert.match(checkoutScript, /zipCode:\s*orderAddress\.zipCode/);
});
