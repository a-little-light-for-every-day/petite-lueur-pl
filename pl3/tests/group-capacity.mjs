import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { newOperations } from '../operations-domain.js';
import { paymentInstructionsFor } from '../payment-instructions.js';
import { installOperations, loadOperations, checkoutOperations, executeOperation, publicOperationsCatalog } from '../operations-store.js';
import { legacyOperationsCatalog } from '../storefront-handoff.js';
import { MAYLA_VIOLET_SKIRT_GROUP, HANAYUME_23_CLAIM_GROUP, remainingGroupCapacity } from '../group-capacity.js';

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

test('five already-purchased Hanayume copies can be claimed without a fabricated cutoff and never oversell', async () => {
 const {env,db}=makeEnvironment();
 try {
  await installOperations(env);
  const state=newOperations();
  state.groups=[{id:HANAYUME_23_CLAIM_GROUP,title:'花とゆめ23號已預購認領',status:'open',deadline:null}];
  state.products=[{id:'hanayume-23',group_id:HANAYUME_23_CLAIM_GROUP,name:'花與夢第23號',sku:'ANIMATE-HANAYUME-2026-23-CLAIM',variant:'安美通販限定特典版',price_twd:170,shipping_units_confirmed:false,manual_review_required:true,quantity_limit:5,status:'available',published:true}];
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  assert.equal(publicOperationsCatalog(state).products.length,1);
  assert.equal(legacyOperationsCatalog(state).products.length,1);
  const submit=(key,n)=>checkoutOperations({key,group_id:HANAYUME_23_CLAIM_GROUP,name:'QA',items:[{product_id:'hanayume-23',quantity:n}],adult_confirmed:true,terms_confirmed:true,review_only:true},key+'@example.test',env);
  await submit('hanayume-claim-00001',3);
  await assert.rejects(()=>submit('hanayume-claim-00002',3),/剩餘接單名額不足/);
  await submit('hanayume-claim-00003',2);
  const full=(await loadOperations(env)).state;
  assert.equal(remainingGroupCapacity(full,HANAYUME_23_CLAIM_GROUP),0);
  assert.equal(publicOperationsCatalog(full).products.length,0);
  assert.equal(legacyOperationsCatalog(full).products.length,0);
  await assert.rejects(()=>submit('hanayume-claim-00004',1),/本團已額滿/);
 } finally {db.close();}
});


test('owner edits a dynamic group cap without changing code; full group blocks checkout and cancellation releases slots', async () => {
 const {env,db}=makeEnvironment();
 try {
  await installOperations(env);
  const state=newOperations(),gid='QA-DYNAMIC-CAP';
  state.groups=[{id:gid,title:'Hello Kitty',status:'open',deadline:'2099-01-01T00:00:00Z',capacity_limit:3}];
  state.products=[{id:'kitty',group_id:gid,name:'Kitty',sku:'NEOGDS-1101690',variant:'',price_twd:765,shipping_units:1,status:'available',published:true}];
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  const request=(key,quantity)=>checkoutOperations({key,group_id:gid,name:'QA',items:[{product_id:'kitty',quantity}],adult_confirmed:true,terms_confirmed:true},key+'@example.test',env);
  assert.equal(remainingGroupCapacity(state,gid),3);
  await request('dynamic-hello-order-0001',2);
  const attempt=await loadOperations(env);
  await assert.rejects(()=>executeOperation({key:'qa-lower-cap-0001',version:attempt.version,command:{type:'group_save',id:gid,title:'Hello Kitty',status:'open',deadline:'2099-01-01T00:00:00Z',capacity_limit:1}},'owner@example.test',env),/上限不得低於現有有效申請/);
  await request('dynamic-hello-order-0002',1);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state,gid),0);
  assert.equal(publicOperationsCatalog((await loadOperations(env)).state).products.length,0);
  await assert.rejects(()=>request('dynamic-hello-order-0003',1),/本團已額滿/);
  const current=await loadOperations(env);
  await executeOperation({key:'qa-cancel-hello-0001',version:current.version,command:{type:'order_cancel',order_id:'PL3-dynamic-hello-order-0001',confirmed:true,reason:'QA release'}},'owner@example.test',env);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state,gid),2);
  await request('dynamic-hello-order-0004',2);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state,gid),0);
  const after=await loadOperations(env);
  await executeOperation({key:'qa-raise-cap-0001',version:after.version,command:{type:'group_save',id:gid,title:'Hello Kitty',status:'open',deadline:'2099-01-01T00:00:00Z',capacity_limit:15}},'owner@example.test',env);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state,gid),12);
 } finally {db.close();}
});

test('configurable capacity survives concurrent checkouts; null means no group cap', async () => {
 const {env,db}=makeEnvironment();
 try {
  await installOperations(env);
  const state=newOperations(),gid='QA-CAP-CONCURRENT';
  state.groups=[{id:gid,title:'Capped',status:'open',deadline:'2099-01-01T00:00:00Z',capacity_limit:3},{id:'UNLIMITED-TEST',title:'Unlimited',status:'open',deadline:'2099-01-01T00:00:00Z',capacity_limit:null}];
  state.products=[{id:'cap-p',group_id:gid,name:'Kitty',sku:'KITTY',variant:'',price_twd:765,shipping_units:1,status:'available',published:true}];
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  assert.equal(remainingGroupCapacity(state,'UNLIMITED-TEST'),null);
  assert.equal(remainingGroupCapacity(state,gid),3);
  const checkout=(key)=>checkoutOperations({key,group_id:gid,name:'QA',items:[{product_id:'cap-p',quantity:2}],adult_confirmed:true,terms_confirmed:true},key+'@example.test',env);
  const results=await Promise.allSettled([checkout('qa-concurrent-cap-0001'),checkout('qa-concurrent-cap-0002')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(remainingGroupCapacity((await loadOperations(env)).state,gid),1);
 } finally {db.close();}
});

test('direct payment atomically reserves stock and opens an authenticated goods-only bill', async () => {
 const {env,db}=makeEnvironment();
 try {
  await installOperations(env);
  const state=newOperations(),gid='QA-DIRECT-PAYMENT';
  state.groups=[{id:gid,title:'QA',status:'open',deadline:'2099-01-01T00:00:00Z',payment_due_at:'2099-01-01T00:00:00Z',capacity_limit:15,direct_payment:true}];
  state.products=[{id:'qa-direct',group_id:gid,name:'QA',sku:'QA',price_twd:765,shipping_units_confirmed:false,status:'available',published:true}];
  state.config.payment_accounts={bank_transfer:'000000000000'};
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  const body={key:'qa-direct-checkout-0001',group_id:gid,name:'QA',items:[{product_id:'qa-direct',quantity:15}],adult_confirmed:true,terms_confirmed:true};
  const customer='qa@example.test';
  const placed=await checkoutOperations(body,customer,env);
  assert.equal(placed.result.direct_payment,true);
  assert.equal((await checkoutOperations(body,customer,env)).replayed,true);
  const current=await loadOperations(env);
  const [order]=current.state.orders,[bill]=current.state.invoices;
  assert.equal(current.state.invoices.length,1);
  assert.equal(order.status,'active');
  assert.equal(order.items[0].shipping_units,null);
  assert.equal(remainingGroupCapacity(current.state,gid),0);
  assert.equal(bill.amount_twd,11475);
  assert.equal(bill.notified,false);
  assert.equal(current.state.notices.length,0);
  assert.equal(paymentInstructionsFor(current.state,order,bill).length,1);
  assert.deepEqual(paymentInstructionsFor(current.state,order,bill,Date.parse(bill.due_at)),[]);
  const report={type:'payment_report',order_id:order.id,authenticated_email:customer,amount_twd:11475,phase:'first',method:'銀行匯款',last5:'00000'};
  await executeOperation({key:'qa-direct-report-0001',version:current.version,command:report},customer,env);
  const reported=await loadOperations(env);
  assert.equal(reported.state.reports[0].status,'pending');
  assert.equal(reported.state.receipts.length,0);
 } finally {db.close();}
});
