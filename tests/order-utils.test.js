import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { menu } from "../menu-data.js";
import {
  calculateTotals,
  getDeliveryZone,
  getPublicOrderConfig,
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

test("the visible HTML menu and the server-side catalog contain the same items and prices", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const rows = [...html.matchAll(/<li data-order-item="([^"]+)">([\s\S]*?)<\/li>/g)];
  assert.equal(rows.length, menu.length);
  const htmlItems = new Map(rows.map(([, id, markup]) => {
    const price = markup.match(/\$(\d+)\.(\d{2})/);
    assert.ok(price, `visible price exists for ${id}`);
    return [id, Number(price[1]) * 100 + Number(price[2])];
  }));
  assert.equal(htmlItems.size, menu.length);
  for (const item of menu) assert.equal(htmlItems.get(item.id), item.priceCents, item.name);
});
