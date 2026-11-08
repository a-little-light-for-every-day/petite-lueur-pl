import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { newOperations } from '../operations-domain.js';
import { installOperations, loadOperations, checkoutOperations, executeOperation, publicOperationsCatalog } from '../operations-store.js';
import { legacyOperationsCatalog } from '../storefront-handoff.js';
import { MAYLA_VIOLET_SKIRT_GROUP, remainingGroupCapacity } from '../group-capacity.js';

function makeEnvironment() {
 const db = new DatabaseSync(':memory:');
 function prepare(sql) {
  let args = [];
  const q = {
   bind(...values) { args = values; return q; },
   async first() { return db.prepare(sql).get(...args) || null; },
   async all() { return { results: db.prepare(sql).all(...args) }; },
   async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
  };
  return q;
 }
 const env = { DB: { prepare, async batch(queries) {
  db.exec('BEGIN');
  try { const result = []; for (const q of queries) result.push(await q.run()); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
 } } };
 return { env, db };
}

test('MAYLA cross-variant three-piece intake quota is atomic, releasable, and unrelated groups remain open', async () => {
 const { env, db } = makeEnvironment();
 try {
  await installOperations(env);
  const state = newOperations();
  state.groups = [
   { id: MAYLA_VIOLET_SKIRT_GROUP, title: 'MAYLA × Violet Evergarden', status: 'open', deadline: '2099-01-01T00:00:00Z' },
   { id: 'OTHER-GROUP', title: 'Other open group', status: 'open', deadline: '2099-01-01T00:00:00Z' },
  ];
  state.products = [
   ...Array.from({ length: 7 }, (_, i) => ({ id: `skirt-${i}`, group_id: MAYLA_VIOLET_SKIRT_GROUP, name: '大圓傘裙', sku: `MAYLA-${i}`, variant: `spec-${i}`, price_twd: 5970, shipping_units: 8, status: 'available', published: true })),
   { id: 'other', group_id: 'OTHER-GROUP', name: 'Other', sku: 'OTHER', variant: '', price_twd: 100, shipping_units: 1, status: 'available', published: true },
  ];
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  const body = (key, items, group_id = MAYLA_VIOLET_SKIRT_GROUP) => ({ key, group_id, name: 'QA', items, adult_confirmed: true, terms_confirmed: true });
  assert.equal(remainingGroupCapacity(state, MAYLA_VIOLET_SKIRT_GROUP), 3);
  assert.equal(remainingGroupCapacity(state, 'OTHER-GROUP'), null);

  const first = body('mayla-test-order-000001', [{ product_id: 'skirt-0', quantity: 1 }, { product_id: 'skirt-1', quantity: 1 }]);
  await checkoutOperations(first, 'qa1@example.test', env);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state, MAYLA_VIOLET_SKIRT_GROUP), 1);
  await assert.rejects(() => checkoutOperations(body('mayla-test-order-000002', [{ product_id: 'skirt-2', quantity: 2 }]), 'qa2@example.test', env), /剩餘接單名額不足/);
  await checkoutOperations(body('mayla-test-order-000003', [{ product_id: 'skirt-6', quantity: 1 }]), 'qa3@example.test', env);
  const full = (await loadOperations(env)).state;
  assert.equal(remainingGroupCapacity(full, MAYLA_VIOLET_SKIRT_GROUP), 0);
  assert.equal(publicOperationsCatalog(full).products.filter(p => p.group_id === MAYLA_VIOLET_SKIRT_GROUP).length, 0);
  assert.equal(legacyOperationsCatalog(full).products.filter(p => p.campaignCode === MAYLA_VIOLET_SKIRT_GROUP).length, 0);
  assert.equal(publicOperationsCatalog(full).products.filter(p => p.group_id === 'OTHER-GROUP').length, 1);
  await assert.rejects(() => checkoutOperations(body('mayla-test-order-000004', [{ product_id: 'skirt-3', quantity: 1 }]), 'qa4@example.test', env), /本團已額滿/);
  assert.equal((await checkoutOperations(first, 'qa1@example.test', env)).replayed, true);

  const current = await loadOperations(env);
  await executeOperation({ key: 'qa-cancel-order-00001', version: current.version, command: { type: 'order_cancel', order_id: 'PL3-mayla-test-order-000001', confirmed: true, reason: 'Local QA cancellation' } }, 'owner@example.test', env);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state, MAYLA_VIOLET_SKIRT_GROUP), 2);
  await checkoutOperations(body('mayla-test-order-000005', [{ product_id: 'skirt-4', quantity: 2 }]), 'qa5@example.test', env);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state, MAYLA_VIOLET_SKIRT_GROUP), 0);
  assert.equal((await loadOperations(env)).state.orders.length, 3);
 } finally { db.close(); }
});

test('simultaneous buyers cannot reserve four MAYLA skirts across separate variants', async () => {
 const { env, db } = makeEnvironment();
 try {
  await installOperations(env);
  const state = newOperations();
  state.groups = [{ id: MAYLA_VIOLET_SKIRT_GROUP, title: 'MAYLA', status: 'open', deadline: '2099-01-01T00:00:00Z' }];
  state.products = [0, 1].map(i => ({ id: `skirt-${i}`, group_id: MAYLA_VIOLET_SKIRT_GROUP, name: '裙', sku: `M-${i}`, variant: `v${i}`, price_twd: 5970, shipping_units: 8, status: 'available', published: true }));
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  const submit = (key, product_id) => checkoutOperations({ key, group_id: MAYLA_VIOLET_SKIRT_GROUP, name: 'QA', items: [{ product_id, quantity: 2 }], adult_confirmed: true, terms_confirmed: true }, `${key}@example.test`, env);
  const results = await Promise.allSettled([submit('mayla-concurrent-0001', 'skirt-0'), submit('mayla-concurrent-0002', 'skirt-1')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected').length, 1);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state, MAYLA_VIOLET_SKIRT_GROUP), 1);
 } finally { db.close(); }
});
