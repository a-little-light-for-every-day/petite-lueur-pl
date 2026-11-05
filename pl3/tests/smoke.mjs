import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker-api-candidate.js";

const database = {
  prepare(sql) {
    return {
      bind() { return this; },
      async first() { return sql.includes("SELECT 1") ? { connected: 1 } : null; },
      async all() { return { results: [] }; }
    };
  }
};
const env = { DB: database, SESSION_SECRET: "test-only-session-secret" };
const get = (path, headers = {}) => worker.fetch(new Request("https://worker.example" + path, { headers }), env);

test("health checks D1 connectivity", async () => {
  const res = await get("/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("never exposes customer orders without auth", async () => {
  const res = await get("/api/orders");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).ok, false);
});

test("published catalog route returns empty list when no rows", async () => {
  const res = await get("/api/groups");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).groups, []);
});

test("rejects unknown routes", async () => {
  const res = await get("/api/admin");
  assert.equal(res.status, 404);
});

test("CORS preflight grants only official Pages origin", async () => {
  const origin = "https://a-little-light-for-every-day.github.io";
  const res = await worker.fetch(new Request("https://worker.example/api/orders", { method:"OPTIONS", headers:{ Origin:origin } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  const refused = await worker.fetch(new Request("https://worker.example/api/orders", { method:"OPTIONS", headers:{ Origin:"https://evil.example" } }), env);
  assert.equal(refused.status, 403);
});

test("rejects checkout without authentication before any inserts", async () => {
  const res = await worker.fetch(new Request("https://worker.example/api/orders", { method:"POST", headers:{ "Content-Type":"application/json" }, body:"{}" }), env);
  assert.equal(res.status, 401);
});
