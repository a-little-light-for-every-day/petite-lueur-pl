import test from "node:test";
import assert from "node:assert/strict";
import { drainOutbox } from "../sync-outbox.js";

test("sync is disabled without server-side adapter credentials", async () => {
  await assert.rejects(drainOutbox({}), error => error.status === 503);
});
test("sync rejects insecure HTTP destinations", async () => {
  await assert.rejects(drainOutbox({
    PL3_SYNC_WEBHOOK_URL: "http://example.com/sync",
    PL3_SYNC_WEBHOOK_SECRET: "local-test-key"
  }), error => error.status === 503);
});
test("empty outbox drains without contacting remote service", async () => {
  const queries = [];
  const env = {
    PL3_SYNC_WEBHOOK_URL: "https://example.com/sync",
    PL3_SYNC_WEBHOOK_SECRET: "local-test-key",
    DB: { prepare(sql) {
      queries.push(sql);
      return { bind() { return { async all() { return { results: [] }; } }; } };
    }}
  };
  const result = await drainOutbox(env);
  assert.deepEqual(result, { ok: true, examined: 0, delivered: 0, retry: 0 });
  assert.match(queries[0], /group_id NOT LIKE/);
});
test("an event with a failed acknowledgement is scheduled for retry", async () => {
  const event = { id:"evt-1", entity_type:"order", entity_id:"order-1",
    event_type:"order.created",payload_json:'{"order_id":"order-1"}',
    status:"pending", attempts:0 };
  const updates = [];
  const env = {
    PL3_SYNC_WEBHOOK_URL: "https://example.com/sync",
    PL3_SYNC_WEBHOOK_SECRET: "local-test-key",
    DB: { prepare(sql) {
      return { bind(...params) {
        if (sql.startsWith("SELECT")) return { async all() { return { results:[event] }; } };
        return { async run() { updates.push({sql,params}); return {meta:{changes:1}}; } };
      }};
    }}
  };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ok:false}), {status:503});
    const result = await drainOutbox(env);
    assert.equal(result.retry,1);
    assert.equal(result.delivered,0);
    assert.equal(updates.length,2);
    assert.match(updates[0].sql,/next_attempt_at IS NULL OR next_attempt_at<=/);
    assert.match(updates[1].sql,/status='retry'/);
  } finally { globalThis.fetch = original; }
});
