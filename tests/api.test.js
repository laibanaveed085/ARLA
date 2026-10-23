import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import orderHandler from "../api/orders.js";
import checkoutSessionHandler from "../api/checkout-session.js";
import checkoutStatusHandler from "../api/checkout-status.js";
import stripeWebhookHandler from "../api/stripe-webhook.js";
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
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PUBLIC_SITE_URL",
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
    STRIPE_SECRET_KEY: "sk_test_arla_test_secret",
    STRIPE_WEBHOOK_SECRET: "whsec_arla_test_secret",
    PUBLIC_SITE_URL: "https://www.thearla.com",
  });
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("retires direct public order writes so payment cannot be bypassed", async (t) => {
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
      items: [{ id: "chicken-biryani", quantity: 2, priceCents: 1 }],
    },
  });

  assert.equal(response.statusCode, 410);
  assert.equal(requestCount, 0);
});

test("creates a server-priced Stripe session and reuses it for an identical request", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  const requestId = "4e891da4-a0c8-4e83-b34e-9b05f5435fbd";
  let savedRecord = null;
  let sessionCreates = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("arla-test.supabase.co")) {
      assert.equal(options.headers.apikey, "test-server-secret");
      if (target.includes("checkout_request_id=eq.")) {
        return new Response(JSON.stringify(savedRecord ? [savedRecord] : []), { status: 200 });
      }
      if (target.includes("on_conflict=checkout_request_id")) {
        savedRecord = JSON.parse(options.body);
        return new Response(null, { status: 201 });
      }
      if (options.method === "PATCH") {
        savedRecord = { ...savedRecord, ...JSON.parse(options.body), stripe_checkout_session_id: "cs_test_arla123" };
        return new Response(JSON.stringify([savedRecord]), { status: 200 });
      }
    }
    if (target === "https://api.stripe.com/v1/checkout/sessions") {
      sessionCreates += 1;
      assert.equal(options.headers.Authorization, "Bearer sk_test_arla_test_secret");
      assert.equal(options.headers["Idempotency-Key"], `arla-checkout-${requestId}`);
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("line_items[0][price_data][unit_amount]"), "1199");
      assert.equal(params.get("line_items[0][quantity]"), "2");
      assert.equal(params.get("line_items[1][price_data][unit_amount]"), "156");
      assert.equal(params.get("metadata[order_id]"), savedRecord.id);
      return new Response(JSON.stringify({ id: "cs_test_arla123", url: "https://checkout.stripe.com/c/pay/test", status: "open" }), { status: 200 });
    }
    if (target === "https://api.stripe.com/v1/checkout/sessions/cs_test_arla123") {
      return new Response(JSON.stringify({ id: "cs_test_arla123", url: "https://checkout.stripe.com/c/pay/test", status: "open" }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const request = {
    method: "POST",
    body: {
      checkoutRequestId: requestId,
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 1 }],
    },
  };
  request.body.items[0].quantity = 2;
  request.body.items[0].priceCents = 1;
  const response = await invoke(checkoutSessionHandler, request);
  const retry = await invoke(checkoutSessionHandler, request);

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().checkoutUrl, "https://checkout.stripe.com/c/pay/test");
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().checkoutUrl, response.json().checkoutUrl);
  assert.equal(sessionCreates, 1);
  assert.equal(savedRecord.payment_status, "pending");
  assert.equal(savedRecord.items[0].price_cents, 1199);
  assert.equal(savedRecord.subtotal_cents, 2398);
  assert.equal(savedRecord.tax_cents, 156);
  assert.equal(savedRecord.total_cents, 2554);
});

test("does not create another Checkout Session while an enabled asynchronous payment is processing", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  const requestId = "4e891da4-a0c8-4e83-b34e-9b05f5435fbd";
  const savedRecord = {
    id: "52cbd03c-8c8c-4c01-bf29-86a15fb5c101",
    order_number: "ARLA-20261023-0123456789ABCDEF",
    customer_name: "Test Customer",
    phone: "240-555-0100",
    email: null,
    fulfillment: "pickup",
    address: null,
    instructions: null,
    requested_time: null,
    items: [{ id: "chicken-biryani", name: "Chicken Biryani", price_cents: 1199, quantity: 1 }],
    subtotal_cents: 1199,
    delivery_fee_cents: 0,
    tax_cents: 78,
    total_cents: 1277,
    payment_status: "pending",
    checkout_request_id: requestId,
    stripe_checkout_session_id: "cs_test_arla123",
  };
  let sessionCreateCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("arla-test.supabase.co")) {
      return new Response(JSON.stringify([savedRecord]), { status: 200 });
    }
    if (String(url) === "https://api.stripe.com/v1/checkout/sessions/cs_test_arla123") {
      return new Response(JSON.stringify({
        id: "cs_test_arla123",
        status: "complete",
        payment_status: "unpaid",
      }), { status: 200 });
    }
    if (String(url) === "https://api.stripe.com/v1/checkout/sessions") {
      sessionCreateCount += 1;
      throw new Error("A second payment session must not be created.");
    }
    throw new Error(`Unexpected fetch ${String(url)}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(checkoutSessionHandler, {
    method: "POST",
    body: {
      checkoutRequestId: requestId,
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 1 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /still processing/i);
  assert.equal(sessionCreateCount, 0);
});

test("rejects invalid checkout quantities before contacting storage", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => { requestCount += 1; return new Response(null, { status: 201 }); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(checkoutSessionHandler, {
    method: "POST",
    body: {
      checkoutRequestId: "4e891da4-a0c8-4e83-b34e-9b05f5435fbd",
      name: "Test Customer",
      phone: "240-555-0100",
      fulfillment: "pickup",
      items: [{ id: "chicken-biryani", quantity: 100 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(requestCount, 0);
});

test("rejects invalid webhook signatures before touching order storage", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => { requestCount += 1; return new Response("[]", { status: 200 }); };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(stripeWebhookHandler, {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=invalid" },
    body: Buffer.from(JSON.stringify({ id: "evt_test", type: "checkout.session.completed", data: { object: {} } })),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(requestCount, 0);
});

test("updates payment state only after a valid signed Stripe event", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/rest\/v1\/rpc\/process_stripe_payment_event$/);
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ duplicate: false, payment_status: "paid" }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const body = Buffer.from(JSON.stringify({
    id: "evt_test_123",
    type: "checkout.session.completed",
    data: { object: {
      id: "cs_test_arla123",
      payment_status: "paid",
      payment_intent: "pi_test_123",
      metadata: { order_id: "52cbd03c-8c8c-4c01-bf29-86a15fb5c101" },
    } },
  }));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", "whsec_arla_test_secret")
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex");
  const response = await invoke(stripeWebhookHandler, {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rpcBody.p_event_id, "evt_test_123");
  assert.equal(rpcBody.p_payment_status, "paid");
  assert.equal(rpcBody.p_session_id, "cs_test_arla123");
});

test("returns only saved payment status for a known Stripe test session", async (t) => {
  configureTestEnvironment(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /stripe_checkout_session_id=eq\.cs_test_arla123/);
    return new Response(JSON.stringify([{
      order_number: "ARLA-20261023-0123456789ABCDEF",
      payment_status: "pending",
      fulfillment: "pickup",
      total_cents: 2554,
      customer_name: "Not returned",
    }]), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await invoke(checkoutStatusHandler, {
    method: "GET",
    query: { session_id: "cs_test_arla123" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    orderNumber: "ARLA-20261023-0123456789ABCDEF",
    paymentStatus: "pending",
    fulfillment: "pickup",
    totalCents: 2554,
  });
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
