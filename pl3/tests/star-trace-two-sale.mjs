import assert from 'node:assert/strict';
import {newOperations,applyOperation,operatingStatus} from '../operations-domain.js';
import {benefitSummary,MEMBERS} from '../operations-benefits.js';
import {createSlots,allocateCards} from '../plave-star-trace.js';
import {BENEFIT_GROUP,normalizeBenefitPreference} from '../benefit-checkout.js';

const pref={members:[...MEMBERS],confirmed:true,allow_repeat:false};
assert.equal(normalizeBenefitPreference(pref).prefer_full_set,true);
assert.equal(normalizeBenefitPreference({...pref,prefer_full_set:false}).prefer_full_set,false);

let state=newOperations(),seq=0;
state.groups=[{id:BENEFIT_GROUP,status:'open',deadline:'2026-11-06T02:00:00.000Z',payment_due_at:'2026-11-07T02:00:00.000Z'}];
state.orders=[{id:'PL-TEST',group_id:BENEFIT_GROUP,email:'qa@example.com',name:'QA',status:'active',items:[{id:'sku-1',name:'STAR TRACE',quantity:2,unit_price_twd:200,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0}]}];
const op=command=>{const v=applyOperation(state,{...command},{id:'qa-'+(++seq),now:'2026-11-06T04:00:00.000Z'});state=v.state;return v.result;};
assert.throws(()=>op({type:'close_group',group_id:BENEFIT_GROUP}),/STAR TRACE/);
op({type:'star_trace_sale_update',phase:'first_complete',confirmed:true,evidence:'一販官方結果'});
assert.equal(operatingStatus(state,state.orders[0]),'一販未購得／自動順延二販');
assert.equal(state.orders[0].items[0].quantity,2);
assert.throws(()=>op({type:'close_group',group_id:BENEFIT_GROUP}),/順延二販/);
assert.throws(()=>op({type:'star_trace_sale_update',phase:'first_complete',confirmed:true,evidence:'重試'}),/已登錄/);
op({type:'star_trace_sale_update',phase:'no_second_sale',confirmed:true,evidence:'官方確認無二販'});
assert.equal(operatingStatus(state,state.orders[0]),'搶購未購得／待退款或結案公告');
const closed=op({type:'close_group',group_id:BENEFIT_GROUP});
assert.equal(closed.blocked.length,1);
assert.equal(state.invoices.length,0,'零實購不產生付款通知');

let cardState=newOperations();cardState.groups=[{id:'g',status:'open'}];
cardState.orders=[{id:'large',group_id:'g',email:'large@example.com',name:'large',status:'active',items:[]},{id:'small',group_id:'g',email:'small@example.com',name:'small',status:'active',items:[]}];
cardState.invoices=['large','small'].map(x=>({id:'bill:'+x,order_id:x,phase:'first',finalized:true,amount_twd:100}));
cardState.allocations=['large','small'].map(x=>({invoice_id:'bill:'+x,amount_twd:100}));
let cardSeq=0;
const command=c=>{const v=applyOperation(cardState,{confirmed:true,evidence:'QA官方證據',campaign_id:'camp',...c},{id:c.id||'benefit-'+(++cardSeq),now:'2026-11-06T04:00:00Z'});cardState=v.state;return v;};
command({type:'benefit_create',id:'camp',group_id:'g',title:'QA'});
command({type:'benefit_batch',id:'batch',official_order:'official'});
command({type:'benefit_entry',batch_id:'batch',order_id:'large',amount_krw:250000,hoodie_qty:0,earphone_qty:0});
command({type:'benefit_entry',batch_id:'batch',order_id:'small',amount_krw:50000,hoodie_qty:0,earphone_qty:0});
command({type:'benefit_preference',customer_key:'large@example.com',members:MEMBERS});
command({type:'benefit_preference',customer_key:'small@example.com',members:MEMBERS});
for(const member of MEMBERS)command({type:'benefit_inventory',batch_id:'batch',member,quantity:1,reference:'arrive-'+member});
command({type:'benefit_draw'});
const campaign=cardState.config.benefit_campaigns[0];
assert.equal(benefitSummary(cardState,campaign).people.find(x=>x.key==='large@example.com').priority_full_set,true);
assert.deepEqual(new Set(campaign.tickets.filter(x=>x.customer_key==='large@example.com').map(t=>t.member)),new Set(MEMBERS));
assert.equal(campaign.tickets.filter(t=>t.full_set_priority).length,5);
assert.equal(campaign.tickets.filter(t=>t.customer_key==='small@example.com'&&t.card_id).length,0);

const customers=[{customer_order_id:'five',lines:[{product_id:'71375',quantity:1,eligible_krw:250000}],preferences:MEMBERS},
 {customer_order_id:'one',lines:[{product_id:'71375',quantity:1,eligible_krw:50000}],preferences:MEMBERS}];
const slots=createSlots(customers),cards=MEMBERS.map((member,i)=>({card_id:'card:'+i,member}));
const allocated=allocateCards({slots,draw_order:[slots[5].id,...slots.slice(0,5).map(s=>s.id)],cards,draw_evidence:'公開抽籤錄影'});
assert.equal(allocated.allocated.filter(x=>x.customer_order_id==='five'&&x.full_set_priority).length,5);
assert.equal(allocated.allocated.filter(x=>x.customer_order_id==='one').length,0);
const withoutSet=allocateCards({slots:createSlots([{...customers[0],prefer_full_set:false}]),draw_order:slots.slice(0,5).map(s=>s.id),cards,draw_evidence:'公開抽籤錄影'});
assert.equal(withoutSet.allocated.some(x=>x.full_set_priority),false);
console.log('STAR TRACE second sale carryover and ₩250k priority full-set allocation passed');
