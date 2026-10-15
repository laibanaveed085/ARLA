import assert from "node:assert/strict";
import test from "node:test";
import orderHandler from "../api/orders.js";
import staffOrdersHandler from "../api/staff/orders.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(status) { this.statusCode = status; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    end(body = "") { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

async function invoke(handler, request) {
  const response = mockResponse();
  await handler(request, response);
  return response;
}

function configureTestEnvironment(t) {
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ARLA_STAFF_EMAILS",
    "ARLA_TAX_RATE",
    "ARLA_TAX_DELIVERY",
    "ARLA_DELIVERY_ZONES",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: "https://arla-test.supabase.co",
    SUPABASE_ANON_KEY: "test-public-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-server-secret",
    ARLA_STAFF_EMAILS: "staff@example.test",
    ARLA_TAX_RATE: "6.5",
    ARLA_TAX_DELIVERY: "false",
    ARLA_DELIVERY_ZONES: "[]",
  });
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("stores server-priced orders and returns confirmation only after the database write", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let savedRecord;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/rest\/v1\/orders$/);
    assert.equal(options.headers.apikey, "test-server-secret");
    savedRecord = JSON.parse(options.body);
    return new Response(null, { status: 201 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(orderHandler, {
    method: "POST",
    body: {
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 2, priceCents: 1 }],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.match(response.json().orderNumber, /^ARLA-\d{8}-[A-F0-9]{16}$/);
  assert.equal(savedRecord.items[0].price_cents, 1199);
  assert.equal(savedRecord.subtotal_cents, 2398);
  assert.equal(savedRecord.tax_cents, 156);
  assert.equal(savedRecord.total_cents, 2554);
});

test("does not return a success-shaped confirmation when database storage fails", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "database unavailable" }), { status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(orderHandler, {
    method: "POST",
    body: {
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 1 }],
    },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().orderNumber, undefined);
  assert.match(response.json().error, /could not receive this order/i);
});

test("rejects invalid quantities before contacting order storage", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => { requestCount += 1; return new Response(null, { status: 201 }); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(orderHandler, {
    method: "POST",
    body: {
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 100 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(requestCount, 0);
});

test("does not expose staff orders when Supabase authentication rejects the token", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("{}", { status: 401 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(staffOrdersHandler, {
    method: "GET",
    headers: { authorization: "Bearer invalid-token" },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(requestCount, 1);
  assert.match(response.json().error, /sign-in has expired/i);
});
