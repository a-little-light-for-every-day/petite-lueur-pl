import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker-api-candidate.js";

const secret = "local-owner-test-key";
const owner = "petitelueur.pl@gmail.com";
const rows = [
  { id: "test-order", customer_email: "customer@example.com", status: "pending" }
];
const reports = [
  { id: "test-report", order_id: "test-order", status: "pending_review" }
];
const db = {
  prepare(sql) {
    return { async all() {
      return { results: sql.includes("FROM payment_reports pr") ? reports : rows };
    }};
  }
};
function signed(email) {
  const payload = Buffer.from(JSON.stringify({
    email, exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return "Bearer " + payload + "." + mac;
}
async function call(path, auth, env = {
  DB: db, PL3_ADMIN_EMAIL: owner, SESSION_SECRET: secret
}) {
  const request = new Request("https://worker.example" + path, {
    headers: auth ? { Authorization: auth } : {}
  });
  const response = await worker.fetch(request, env);
  return { status: response.status, data: await response.json() };
}
test("owner order overview requires authentication", async () => {
  const result = await call("/api/admin/orders");
  assert.equal(result.status, 401);
});
test("non-owner cannot read other customers or payment reports", async () => {
  for (const path of ["/api/admin/orders", "/api/admin/payment-reports"]) {
    const result = await call(path, signed("other@example.com"));
    assert.equal(result.status, 403);
    assert.equal(result.data.error, "Forbidden");
  }
});
test("signed owner sees read-only orders and pending review queue", async () => {
  const orders = await call("/api/admin/orders", signed(owner));
  const pending = await call("/api/admin/payment-reports", signed(owner));
  assert.equal(orders.status, 200);
  assert.deepEqual(orders.data.orders, rows);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data.reports, reports);
});
test("owner endpoint fails closed without server-side owner configuration", async () => {
  const result = await call("/api/admin/orders", signed(owner),
    { DB: db, SESSION_SECRET: secret });
  assert.equal(result.status, 503);
});
