import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {STAR_TRACE_ADVANCE_LIMIT_TWD,starTraceAdmission,starTraceCost} from '../star-trace-admission.js';
import {BENEFIT_GROUP} from '../benefit-checkout.js';
import {newOperations,applyOperation,operatingStatus} from '../operations-domain.js';
import {checkoutOperations,installOperations} from '../operations-store.js';
import {benefitSummary} from '../operations-benefits.js';

const date='2099-01-01T00:00:00.000Z';
const testPreference={members:['藝俊','諾亞','斑比','銀虎','河玟'],confirmed:true,allow_repeat:true};
const hoodie={sku:'WV-PLAVE-71386-M',quantity:1,unit_price_twd:2390,name:'厚磅帽T',shipping_units:1};
const badge={sku:'WV-PLAVE-71377',quantity:1,unit_price_twd:155,name:'隨機徽章',shipping_units:1};

function fixtureState(){
 const s=newOperations();
 s.groups=[{id:BENEFIT_GROUP,title:'STAR TRACE',status:'open',deadline:date,auto_close:false,payment_due_at:null}];
 s.products=[{id:'hoodie',group_id:BENEFIT_GROUP,published:true,status:'available',image_official:true,...hoodie,price_twd:hoodie.unit_price_twd,variant:'M'},
  {id:'badge',group_id:BENEFIT_GROUP,published:true,status:'available',image_official:true,...badge,price_twd:badge.unit_price_twd,variant:''}];
 return s;
}

function fakeDb(){
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}}}},async batch(stmts){db.exec('BEGIN');try{const rows=[];for(const stmt of stmts)rows.push(await stmt.run());db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}};
 return{db,env:{DB}};
}

test('official tax-inclusive Korean prices use a conservative NT$20k budget',()=>{
 assert.deepEqual(starTraceCost([badge,hoodie]),{amount_krw:92000,estimated_twd:2484});
 assert.equal(STAR_TRACE_ADVANCE_LIMIT_TWD,20000);
 const state=fixtureState();
 state.orders.push({id:'older',group_id:BENEFIT_GROUP,status:'active',items:[{...hoodie,quantity:8}]});
 const next=starTraceAdmission(state,[hoodie]);
 assert.equal(next.occupied_twd,18792);
 assert.equal(next.status,'waitlisted');
 assert.equal(starTraceAdmission(state,[badge]).status,'active');
 state.orders.push({id:'PL3-41d8879f-c673-449e-9e77-cfd8ef98fadf',group_id:BENEFIT_GROUP,status:'active',items:[hoodie]});
 assert.equal(starTraceAdmission(state,[badge]).occupied_twd,18792,'existing owner QA is exempt');
});

test('public checkout allocates budget atomically; overflow remains a valid standby order',async()=>{
 const {db,env}=fakeDb();
 try{
  await installOperations(env);
  const state=fixtureState();
  state.orders.push({id:'existing',group_id:BENEFIT_GROUP,status:'active',items:[{...hoodie,quantity:8}]});
  db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
  const buy=(key,product_id)=>checkoutOperations({key,group_id:BENEFIT_GROUP,name:'測試',items:[{product_id,quantity:1}],adult_confirmed:true,terms_confirmed:true,benefit_preference:testPreference},key+'@example.com',env);
  const [a,b]=await Promise.all([buy('abcdefgh1234567890','badge'),buy('abcdefgh1234567891','hoodie')]);
  assert.equal(a.result.status,'active');
  assert.equal(b.result.status,'waitlisted');
  assert.equal((await buy('abcdefgh1234567891','hoodie')).replayed,true,'retry is idempotent');
  const s=JSON.parse(db.prepare("SELECT document_json FROM pl_ops_state WHERE id='main'").get().document_json);
  assert.equal(s.invoices?.length||0,0,'no payment is created at checkout');
 }finally{db.close();}
});

test('standby does not receive purchase, billing, or draw eligibility; owner can promote with evidence',()=>{
 let s=fixtureState();s.orders=[
  {id:'old',group_id:BENEFIT_GROUP,status:'active',items:[{...hoodie,quantity:8}]},
  {id:'standby',group_id:BENEFIT_GROUP,status:'waitlisted',items:[hoodie],goods_twd:2390,benefit_preference:testPreference,acceptance:{adult_confirmed:true}}];
 assert.match(operatingStatus(s,s.orders[1]),/候補/);
 assert.equal(benefitSummary(s,{group_id:BENEFIT_GROUP,entries:[],batches:[],preferences:{},cards:[]}).people.length,0);
 assert.throws(()=>applyOperation(s,{type:'purchase_record',shop:'Weverse',official_order:'A',currency:'KRW',original_amount:87000,actual_twd:0,advance_approved:true,advance_reason:'先代墊',items:[{order_id:'standby',item_id:'x',quantity:1}],evidence:'official'},{id:'blocked'}),/有效|找不到/);
 s=applyOperation(s,{type:'order_cancel',order_id:'old',confirmed:true,reason:'已確認取消'},{id:'cancel'}).state;
 s=applyOperation(s,{type:'order_promote',order_id:'standby',confirmed:true,evidence:'取消後額度重新核對'},{id:'promote',now:'2026-11-05T01:00:00Z'}).state;
 assert.equal(s.orders[1].status,'active');
 assert.equal(s.orders[1].admission.estimated_twd,2349);
});

test('STAR TRACE close bills only verifiably purchased quantities, never requested quantities',()=>{
 let s=fixtureState();
 s.orders=[{id:'partial',group_id:BENEFIT_GROUP,name:'測試',email:'a@example.com',status:'active',goods_twd:310,first_channel:'transfer',items:[{...badge,quantity:2,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0,id:'part-a'}]}];
 let result=applyOperation(s,{type:'close_group',group_id:BENEFIT_GROUP,payment_due_at:'2099-01-02T00:00:00Z'},{id:'pre'});
 assert.equal(result.state.invoices.length,0);
 assert.match(result.result.blocked[0].reason,/實購/);
 s.orders[0].items[0].purchased=1;
 result=applyOperation(s,{type:'close_group',group_id:BENEFIT_GROUP,payment_due_at:'2099-01-02T00:00:00Z'},{id:'post'});
 assert.equal(result.state.invoices[0].amount_twd,155);
 assert.match(result.state.notices[0].body,/徽章 ×1 · NT\$155/);
 assert.doesNotMatch(result.state.notices[0].body,/徽章 ×2/);
});
