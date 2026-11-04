import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import worker from '../worker-api-candidate.js';
import {newOperations,applyOperation,balance} from '../operations-domain.js';
import {installOperations,loadOperations,executeOperation} from '../operations-store.js';
import {remainingClaimSlots,publicOperationsCatalog} from '../operations-store.js';
import {drainOperationsMirror,operationsMirrorStatus} from '../operations-mirror.js';

const SITE='https://pl3-local-test.example';
const EMAIL='acceptance@example.invalid';
const CODE='123456';

function isolatedEnvironment(){
 const db=new DatabaseSync(':memory:');
 const prepare=sql=>{let args=[];const query={
  bind(...values){args=values;return query},
  async first(){return db.prepare(sql).get(...args)||null},
  async all(){return{results:db.prepare(sql).all(...args)}},
  async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}}
 };return query};
 return {db,SESSION_SECRET:'acceptance-session-secret',OTP_PEPPER:'acceptance-pepper',
  PL3_OPS_MAIL_ENABLED:'false',PL3_OPS_SYNC_ENABLED:'true',
  PL3_FORMAL_SYNC_SECRET:'isolated-not-production',
  PL3_FORMAL_SHEETS_WEBHOOK_URL:'https://script.google.com/macros/s/local-fake/exec',
  DB:{prepare,async exec(sql){db.exec(sql)},async batch(queries){db.exec('BEGIN');try{const result=[];for(const q of queries)result.push(await q.run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}}
 };
}
async function api(env,path,{method='GET',token,body}={}){
 const headers={'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const res=await worker.fetch(new Request(SITE+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);
 return {status:res.status,body:await res.json()};
}
async function ownerCommand(env,command,key){
 const {version}=await loadOperations(env);
 return executeOperation({key,version,command},'isolated-owner',env);
}

test('isolated OTP → order → first/second payment → both mirror destinations → customer lookup',async()=>{
 const env=isolatedEnvironment();
 try{
  await installOperations(env);
  env.db.exec('CREATE TABLE otp_codes(id TEXT PRIMARY KEY,email TEXT,code_hash TEXT,expires_at TEXT,attempts INTEGER DEFAULT 0,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const digest=createHash('sha256').update(env.OTP_PEPPER+':'+EMAIL+':'+CODE).digest('base64url');
  env.db.prepare('INSERT INTO otp_codes(id,email,code_hash,expires_at) VALUES(?,?,?,?)').run('otp-qa',EMAIL,digest,new Date(Date.now()+600000).toISOString());

  // Fake OTP was inserted directly into an in-memory DB: no Gmail or real account contacted.
  const login=await api(env,'/api/auth/verify-code',{method:'POST',body:{email:EMAIL,code:CODE}});
  assert.equal(login.status,200);
  const token=login.body.token;
  assert.equal((await api(env,'/api/auth/verify-code',{method:'POST',body:{email:EMAIL,code:CODE}})).status,401);
  assert.equal((await api(env,'/api/auth/session',{token})).body.email,EMAIL);

  let state=newOperations();
  state=applyOperation(state,{type:'group_save',id:'G-ACCEPT',title:'隔離驗收團次',status:'open',deadline:new Date(Date.now()+86400000).toISOString(),payment_due_at:new Date(Date.now()+172800000).toISOString()},{id:'qa-group'}).state;
  state=applyOperation(state,{type:'product_save',id:'P-ACCEPT',group_id:'G-ACCEPT',name:'隔離測試商品',sku:'TEST-ONLY-001',price_twd:445,shipping_units:2,claim_capacity:2,manual_claims:0,source_url:'https://example.invalid/official',image_url:'',published:true,confirmed:true,status:'available'},{id:'qa-product'}).state;
  const productId=state.products[0].id;
  env.db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  assert.equal((await api(env,'/api/operations/catalog')).body.products.length,1);

  const request={key:'isolatedKey1234567',group_id:'G-ACCEPT',name:'隔離測試客人',adult_confirmed:true,terms_confirmed:true,items:[{product_id:productId,quantity:2}]};
  const checkout=await api(env,'/api/operations/checkout',{method:'POST',token,body:request});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  assert.equal((await api(env,'/api/operations/checkout',{method:'POST',token,body:request})).body.replayed,true);
  assert.equal((await loadOperations(env)).state.orders.length,1);
  assert.equal((await api(env,'/api/operations/catalog')).body.products.length,0,'filled split item is no longer orderable');
  assert.equal((await api(env,'/api/operations/checkout',{method:'POST',token,body:{...request,key:'anotherKey1234567'}})).status,409,'another order cannot exceed shared allocation');
  await ownerCommand(env,{type:'close_group',group_id:'G-ACCEPT'},'owner-close-qa');
  let current=(await loadOperations(env)).state;
  assert.equal(current.invoices.length,1);
  assert.equal(current.notices[0].status,'draft');
  assert.match(current.notices[0].body,/https:\/\/a-little-light-for-every-day\.petitelueur-pl\.workers\.dev\/account/);
  assert.doesNotMatch(current.notices[0].body,/pl3-staging-api/);
  assert.equal(balance(current,current.invoices[0]),890);

  const reported=await api(env,'/api/operations/payment-report',{method:'POST',token,body:{key:'customer-pay-qa-1',command:{order_id:checkout.body.result.order_id,amount_twd:890,method:'銀行匯款',last5:'12345'}}});
  assert.equal(reported.status,200,JSON.stringify(reported.body));
  current=(await loadOperations(env)).state;
  assert.equal(current.reports[0].status,'pending');
  assert.equal(balance(current,current.invoices[0]),890,'customer report must not automatically settle');

  await ownerCommand(env,{type:'receipt_confirm',customer_email:EMAIL,amount_twd:890,kind:'bank_confirmed',transaction_id:'FAKE-FIRST-ONLY',evidence:'isolated fake bank row',confirmed:true,allocations:[{invoice_id:current.invoices[0].id,amount_twd:890}]},'owner-first-confirm-qa');
  await ownerCommand(env,{type:'second_settle',order_id:checkout.body.result.order_id,costs:{international:100,domestic:38},confirmed:true,evidence:'isolated fake shipping invoice'},'owner-second-invoice-qa');
  current=(await loadOperations(env)).state;
  const second=current.invoices.find(i=>i.phase==='second');
  assert.equal(balance(current,current.invoices[0]),0);
  assert.equal(balance(current,second),138);
  await ownerCommand(env,{type:'receipt_confirm',customer_email:EMAIL,amount_twd:138,kind:'bank_confirmed',transaction_id:'FAKE-SECOND-ONLY',evidence:'isolated fake bank row',confirmed:true,allocations:[{invoice_id:second.id,amount_twd:138}]},'owner-second-confirm-qa');

  const eventIds=[];
  const transport=async(_url,opt)=>{
   const request=JSON.parse(JSON.parse(opt.body).body);
   eventIds.push(request.destination+':'+request.event_id);
   return new Response(JSON.stringify({ok:true,ack_event_id:request.event_id,destination:request.destination,remote_id:'isolated-'+request.destination,remote_revision:'qa-v1'}));
  };
  assert.equal((await drainOperationsMirror(env,{limit:6,transport})).handled,2);
  assert.equal((await operationsMirrorStatus(env)).delivered,2);
  assert.equal((await drainOperationsMirror(env,{limit:6,transport})).handled,0);
  assert.equal(eventIds.length,2);

  const my=await api(env,'/api/operations/my-orders',{token});
  assert.equal(my.status,200);
  assert.equal(my.body.orders.length,1);
  assert.deepEqual(my.body.orders[0].invoices.map(i=>i.outstanding_twd),[0,0]);
  assert.equal((await api(env,'/api/operations/my-orders')).status,401);
  assert.equal((await loadOperations(env)).state.notices.every(n=>['draft','void'].includes(n.status)),true,'no customer emails queued or sent');
 }finally{env.db.close()}
});

test('split-group manual holds reduce available capacity without changing per-order limit',()=>{
 let s=newOperations();
 s=applyOperation(s,{type:'group_save',id:'G-SPLIT',title:'隔離拆團',status:'open',deadline:new Date(Date.now()+86400000).toISOString()},{id:'split-group'}).state;
 const attrs={type:'product_save',group_id:'G-SPLIT',name:'角色認領',sku:'CHAR-A',price_twd:250,shipping_units:1,source_url:'https://example.invalid/official',published:true,confirmed:true,claim_capacity:3,manual_claims:1,quantity_limit:3};
 s=applyOperation(s,attrs,{id:'split-item'}).state;
 const p=s.products[0];
 assert.equal(remainingClaimSlots(s,p),2);
 assert.equal(publicOperationsCatalog(s).products[0].remaining_slots,2);
 s=applyOperation(s,{type:'order_save',id:'CUSTOMER-SPLIT',name:'隔離買家',email:EMAIL,group_id:'G-SPLIT',items:[{name:p.name,sku:p.sku,quantity:2,unit_price_twd:250,shipping_units:1}]},{id:'split-order'}).state;
 assert.equal(remainingClaimSlots(s,p),0);
 assert.equal(publicOperationsCatalog(s).products.length,0);
  assert.throws(()=>applyOperation(s,{type:'order_save',id:'OTHER-ORDER',name:'第二位',email:'other@example.invalid',group_id:'G-SPLIT',items:[{name:p.name,sku:p.sku,quantity:1,unit_price_twd:250}]},{id:'overbook'}),/拆團名額已不足/);
  assert.throws(()=>applyOperation(s,{type:'order_details',id:'CUSTOMER-SPLIT',name:'隔離買家',email:EMAIL,items:[{...s.orders[0].items[0],quantity:3}]},{id:'overedit'}),/拆團名額已不足/);
 assert.throws(()=>applyOperation(s,{...attrs,id:p.id,claim_capacity:2},{id:'bad-owner-edit'}),/總名額小於/);
});
