import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation,balance} from '../operations-domain.js';
import {operationsMirrorDocuments} from '../operations-mirror.js';

const NOW='2026-11-11T11:00:00.000Z';
function fixture(){
 const s=newOperations();
 const id='PL-261001-220219';
 s.orders.push({id,group_id:'PLAVE',name:'測試客戶',email:'customer@example.com',status:'active',goods_twd:2400,items:[
  {id:'fan',name:'扇套',sku:'SHOP-69177',quantity:1,unit_price_twd:null,shipping_units:1,purchased:1,overseas:1,transit:0,taiwan:0,shipped:0,delivered:0},
  {id:'bag',name:'肩背包',sku:'SHOP-69180',quantity:1,unit_price_twd:null,shipping_units:1,purchased:1,overseas:1,transit:0,taiwan:0,shipped:0,delivered:0}
 ]});
 s.invoices.push({id:'first',order_id:id,phase:'first',amount_twd:2400,finalized:true,notified:true,status:'open',channel:'transfer'},
  {id:'second',order_id:id,phase:'second',amount_twd:0,finalized:false,notified:false,status:'open',channel:'transfer',due_at:null});
 s.receipts.push({id:'receipt',customer_email:'customer@example.com',amount_twd:2400});
 s.allocations.push({id:'allocation',invoice_id:'first',receipt_id:'receipt',amount_twd:2400});
 s.notices.push({id:'original-first',kind:'payment',status:'sent',order_ids:[id],invoice_ids:['first'],gmail_message_id:'gmail-original'});
 return s;
}
const draft={type:'second_cost_draft',order_id:'PL-261001-220219',confirmed:true,evidence:'NW9162348 実費 NT$1,717，五十份分攤；日本原單國內運費已核實',shipment_reference:'NW9162348',costs:{japan:161,international:309,packaging:null,tax:null,domestic:38},shipping_units:[{item_id:'fan',units:4},{item_id:'bag',units:5}]};

test('persist confirmed freight without finalizing an existing second invoice or mutating paid first stage',()=>{
 const before=fixture(),first=structuredClone(before.invoices[0]),second=structuredClone(before.invoices[1]),allocations=structuredClone(before.allocations),notices=structuredClone(before.notices);
 const {state,result}=applyOperation(before,draft,{id:'draft1',now:NOW});
 assert.deepEqual(state.invoices,[first,second]);
 assert.deepEqual(state.allocations,allocations);
 assert.deepEqual(state.notices,notices);
 assert.equal(state.orders[0].goods_twd,2400);
 assert.deepEqual(state.orders[0].items.map(x=>x.unit_price_twd),[null,null]);
 assert.deepEqual(state.orders[0].items.map(x=>x.shipping_units),[4,5]);
 assert.deepEqual(state.orders[0].second_cost_draft.costs,draft.costs);
 assert.deepEqual(result.pending,['packaging','tax']);
 assert.equal(result.known_costs_twd,508);
 assert.equal(balance(state,state.invoices[0]),0);
 assert.equal(state.invoices[1].finalized,false);
 assert.equal(operationsMirrorDocuments(state)[0].document.order.second_cost_draft.shipment_reference,'NW9162348');
});

test('unknown is different from a confirmed zero; draft can be revised without billing or mail',()=>{
 let state=applyOperation(fixture(),draft,{id:'draft1',now:NOW}).state;
 ({state}=applyOperation(state,{...draft,costs:{packaging:15,tax:0}},{id:'draft2',now:NOW}));
 assert.deepEqual(state.orders[0].second_cost_draft.costs,{japan:161,international:309,packaging:15,tax:0,domestic:38});
 assert.equal(state.invoices[1].amount_twd,0);
 assert.equal(state.notices.length,1);
 assert.throws(()=>applyOperation(state,{...draft,shipping_units:[{item_id:'other',units:5},{item_id:'bag',units:5}]},{id:'invalid',now:NOW}),/重複或不屬於/);
 assert.throws(()=>applyOperation(state,{...draft,shipping_units:[{item_id:'fan',units:4},{item_id:'fan',units:5}]},{id:'invalid',now:NOW}),/重複或不屬於/);
 assert.throws(()=>applyOperation(state,{...draft,costs:{japan:-1}},{id:'invalid',now:NOW}),/金額/);
});

test('final settlement requires all pending costs, due date and consistency with saved draft',()=>{
 let state=applyOperation(fixture(),draft,{id:'draft1',now:NOW}).state;
 const settle={type:'second_settle',order_id:draft.order_id,costs:{japan:161,international:309,packaging:0,tax:0,domestic:38},confirmed:true,evidence:'complete second costs'};
 assert.throws(()=>applyOperation(state,settle,{id:'invalid',now:NOW}),/付款期限/);
 assert.throws(()=>applyOperation(state,{...settle,due_at:'2026-11-15T12:00:00Z',costs:{...settle.costs,japan:160}},{id:'invalid',now:NOW}),/暫存分攤不符/);
 assert.throws(()=>applyOperation(state,{...settle,due_at:'2026-11-15T12:00:00Z',costs:{...settle.costs,packaging:null}},{id:'invalid',now:NOW}),/尚未補齊/);
 ({state}=applyOperation(state,{...settle,due_at:'2026-11-15T12:00:00Z'},{id:'final',now:NOW}));
 assert.equal(state.invoices[1].finalized,true);
 assert.equal(state.invoices[1].amount_twd,508);
 assert.equal(state.notices.length,1);
 assert.throws(()=>applyOperation(state,draft,{id:'late',now:NOW}),/二補已正式結算/);
});
