import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker-api-candidate.js";

const SECRET = "local-test-session-secret-not-for-production";
const BASE = "https://worker.example";
const email = "pl3-test@example.com";

function authFor(address = email) {
  const payload = Buffer.from(JSON.stringify({
    email: address, exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  return "Bearer " + payload + "." +
    createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function makeDB() {
  const state = {
    groups: new Map([["PL3-TEST", {
      id: "PL3-TEST", status: "open", published: 1,
      order_deadline: new Date(Date.now() + 86400000).toISOString()
    }]]),
    products: new Map([["SKU-TEST", {
      id: "SKU-TEST", group_id: "PL3-TEST", name: "測試商品",
      variant: "測試款", price_twd: 350, quantity_limit: 4, status: "available"
    }]]),
    orders: [], items: [], fulfillments: [], keys: new Map(),
    outbox: [], reports: []
  };
  function prepared(sql) {
    return {
      sql, args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (sql.includes("FROM api_idempotency")) return state.keys.get(this.args[0]) ?? null;
        if (sql.includes("FROM groups")) return state.groups.get(this.args[0]) ?? null;
        if (sql.includes("FROM products")) {
          const p = state.products.get(this.args[0]);
          return p?.group_id === this.args[1] ? p : null;
        }
        if (sql.includes("FROM orders")) {
          if(sql.includes("group_id=?"))return state.orders.find(o=>o.id===this.args[0]&&o.group_id===this.args[1]&&o.customer_email===this.args[2]&&o.customer_name===this.args[3]&&o.payment_status==="unpaid")??null;
          return state.orders.find(o => o.id === this.args[0] &&
            o.customer_email === this.args[1]) ?? null;
        }
        if (sql.includes("FROM payment_reports")) return state.reports.find(r=>r.order_id===this.args[0])??null;
        throw new Error("Unexpected first SQL: " + sql);
      },
      async all() {
        if (sql.includes("FROM orders")) return {
          results: state.orders.filter(o => o.customer_email === this.args[0])
        };
        throw new Error("Unexpected all SQL: " + sql);
      },
      async run() {
        if (!sql.startsWith("INSERT INTO payment_reports")) throw new Error("Unexpected run SQL: " + sql);
        const [id, order_id, method, amount_twd, reference_last5, note] = this.args;
        state.reports.push({ id, order_id, method, amount_twd, reference_last5, note, status: "pending_review" });
        return { meta: { changes: 1 } };
      }
    };
  }
  return {
    state,
    prepare: prepared,
    async batch(statements) {
      for (const stmt of statements) {
        const args = stmt.args, sql = stmt.sql;
        if (sql.startsWith("INSERT INTO orders")) {
          const [id, customer_email, customer_name, group_id, total_twd] = args;
          state.orders.push({ id, customer_email, customer_name, group_id, total_twd,
            status: "pending", payment_status: "unpaid" });
        } else if (sql.startsWith("INSERT INTO order_items")) {
          state.items.push(args);
        } else if (sql.startsWith("INSERT INTO fulfillments")) {
          state.fulfillments.push(args);
        } else if (sql.startsWith("INSERT INTO api_idempotency")) {
          const [key, request_hash, order_id] = args;
          if (state.keys.has(key)) throw new Error("Duplicate key");
          state.keys.set(key, { order_id, request_hash });
        } else if (sql.startsWith("INSERT INTO sync_outbox")) {
          state.outbox.push(args);
        } else {
          throw new Error("Unexpected batch SQL: " + sql);
        }
      }
    }
  };
}

async function request(env, path, method, body, authorization = authFor()) {
  const headers = { Authorization: authorization };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  return { status: res.status, data: await res.json() };
}

const payload = (overrides = {}) => ({
  idempotency_key: "test_unique_checkout_key_001",
  customer_name: "PL3 測試使用者",
  group_id: "PL3-TEST",
  items: [{ product_id: "SKU-TEST", quantity: 2 }],
  ...overrides
});

test("checkout inserts one order, items, fulfillment, and sync event; retry is idempotent", async () => {
  const db = makeDB(), env = { DB: db, SESSION_SECRET: SECRET };
  const first = await request(env, "/api/orders", "POST", payload());
  assert.equal(first.status, 201);
  assert.equal(first.data.total_twd, 700);
  assert.equal(db.state.orders.length, 1);
  assert.equal(db.state.items.length, 1);
  assert.equal(db.state.fulfillments.length, 1);
  assert.equal(db.state.outbox.length, 1);
  const repeated = await request(env, "/api/orders", "POST", payload());
  assert.equal(repeated.status, 201);
  assert.equal(repeated.data.replayed, true);
  assert.equal(repeated.data.order_id, first.data.order_id);
  assert.equal(db.state.orders.length, 1);
  const changed = await request(env, "/api/orders", "POST",
    payload({ items: [{ product_id: "SKU-TEST", quantity: 3 }] }));
  assert.equal(changed.status, 409);
  assert.equal(db.state.orders.length, 1);
});

test("private QA checkout is owner-only, allows exact draft cohort, and replays without duplicate or financial settlement", async()=>{
 const db=makeDB(),env={DB:db,SESSION_SECRET:SECRET,PL3_ADMIN_EMAIL:email,PL3_FORMAL_ALLOWED_GROUP_ID:"PL3-FORMAL-REHEARSAL-01",PL3_FORMAL_SYNC_ENABLED:"true"};
 db.state.groups.set("PL3-FORMAL-REHEARSAL-01",{id:"PL3-FORMAL-REHEARSAL-01",status:"draft",published:0,order_deadline:null});
 db.state.products.set("PL3-TEST-PRODUCT-20261101-01",{id:"PL3-TEST-PRODUCT-20261101-01",group_id:"PL3-FORMAL-REHEARSAL-01",name:"PL3 假商品",variant:"測試",price_twd:100,quantity_limit:1,status:"available"});
 const route="/api/admin/qa/checkout",key="qa_checkout_unique_key_1";
 assert.equal((await request(env,route,"POST",{idempotency_key:key},authFor("not-owner@example.com"))).status,403);
 assert.equal((await request(env,"/api/orders","POST",{...payload(),group_id:"PL3-FORMAL-REHEARSAL-01",items:[{product_id:"PL3-TEST-PRODUCT-20261101-01",quantity:1}]})).status,409);
 const created=await request(env,route,"POST",{idempotency_key:key});
 assert.equal(created.status,201);assert.equal(created.data.total_twd,100);
 const repeat=await request(env,route,"POST",{idempotency_key:key});
 assert.equal(repeat.data.replayed,true);assert.equal(repeat.data.order_id,created.data.order_id);
 assert.equal(db.state.orders.length,1);assert.equal(db.state.outbox.length,1);
 const reported=await request(env,"/api/admin/qa/payment-report","POST",{order_id:created.data.order_id});
 assert.equal(reported.status,201);assert.equal(reported.data.status,"pending_review");
 const again=await request(env,"/api/admin/qa/payment-report","POST",{order_id:created.data.order_id});
 assert.equal(again.data.replayed,true);assert.equal(db.state.reports.length,1);
 assert.equal(db.state.orders[0].payment_status,"unpaid");
 const disallowed={...env,PL3_FORMAL_ALLOWED_GROUP_ID:"other"};
 assert.equal((await request(disallowed,route,"POST",{idempotency_key:"qa_checkout_unique_key_2"})).status,409);
});

test("checkout rejects unpublished groups, closed groups, and invalid quantities", async () => {
  const db = makeDB(), env = { DB: db, SESSION_SECRET: SECRET };
  db.state.groups.get("PL3-TEST").published = 0;
  assert.equal((await request(env, "/api/orders", "POST", payload())).status, 409);
  db.state.groups.get("PL3-TEST").published = 1;
  db.state.groups.get("PL3-TEST").order_deadline = new Date(Date.now() - 1000).toISOString();
  assert.equal((await request(env, "/api/orders", "POST", payload())).status, 409);
  db.state.groups.get("PL3-TEST").order_deadline = new Date(Date.now() + 86400000).toISOString();
  for (const items of [
    [{ product_id: "SKU-TEST", quantity: 0 }],
    [{ product_id: "SKU-TEST", quantity: 5 }],
    [{ product_id: "SKU-TEST", quantity: 1 }, { product_id: "SKU-TEST", quantity: 1 }]
  ]) {
    const result = await request(env, "/api/orders", "POST", payload({ items }));
    assert.equal(result.status, items.length === 2 || items[0].quantity === 0 ? 400 : 409);
  }
  assert.equal(db.state.orders.length, 0);
});

test("checkout enforces NT$22,000 cap without inserts", async () => {
  const db = makeDB(), env = { DB: db, SESSION_SECRET: SECRET };
  db.state.products.get("SKU-TEST").price_twd = 11001;
  const result = await request(env, "/api/orders", "POST", payload());
  assert.equal(result.status, 409);
  assert.equal(db.state.orders.length, 0);
});

test("payment report belongs to authenticated order; stored for review only", async () => {
  const db = makeDB(), env = { DB: db, SESSION_SECRET: SECRET };
  const created = await request(env, "/api/orders", "POST", payload());
  assert.equal(created.status, 201);
  const order_id = created.data.order_id;
  const payment = {
    order_id, method: "bank_transfer", amount_twd: 700,
    reference_last5: "12345", note: "TEST ONLY"
  };
  const accepted = await request(env, "/api/payment-reports", "POST", payment);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.data.status, "pending_review");
  assert.equal(db.state.reports.length, 1);
  assert.equal(db.state.orders[0].payment_status, "unpaid");
  const intruder = await request(env, "/api/payment-reports", "POST",
    payment, authFor("other@example.com"));
  assert.equal(intruder.status, 404);
  assert.equal(db.state.reports.length, 1);
  const invalid = await request(env, "/api/payment-reports", "POST",
    { ...payment, amount_twd: 22001 });
  assert.equal(invalid.status, 400);
  assert.equal(db.state.reports.length, 1);
});

test("unauthenticated checkout and payment report cannot write", async () => {
  const db = makeDB(), env = { DB: db, SESSION_SECRET: SECRET };
  assert.equal((await request(env, "/api/orders", "POST", payload(), "")).status, 401);
  assert.equal((await request(env, "/api/payment-reports", "POST", {
    order_id: "missing", method: "other", amount_twd: 1
  }, "")).status, 401);
  assert.equal(db.state.orders.length, 0);
  assert.equal(db.state.reports.length, 0);
});
