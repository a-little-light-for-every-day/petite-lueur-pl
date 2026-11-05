import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations} from '../operations-domain.js';
import {operationsMirrorDocuments} from '../operations-mirror.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('STAR TRACE sync keeps independent group record without rewriting unrelated orders',()=>{
  const state=newOperations();
  state.orders=[{id:'QA-PERK-001',email:'qa@example.invalid',status:'open',items:[],goods_twd:500},
    {id:'REAL-UNRELATED',email:'unrelated@example.invalid',status:'open',items:[],goods_twd:600}];
  const star={customers:[{customer_order_id:'QA-PERK-001',lines:[{product_id:'71375',quantity:1,eligible_krw:50000}],preferences:['藝俊','諾亞','斑比','銀虎','河玟']}],
    allocation:{allocated:[{customer_order_id:'QA-PERK-001',slot_id:'QA-PERK-001:slot:1',member:'藝俊',card_id:'card1'}],unallocated:[]}};
  const docs=operationsMirrorDocuments(state,star);
  assert.equal(docs[0].document.star_trace,undefined);
  assert.equal(Object.hasOwn(docs[1].document,'star_trace'),false);
  assert.equal(docs.filter(x=>x.kind==='order').length,2);
});

test('existing benefit desk maps full campaign into receiver-compatible independent group',()=>{
 const s=newOperations();
 s.orders=[{id:'PL-QA-1',group_id:'qa',email:'qa@example.invalid',name:'QA',status:'active'}];
 s.invoices=[{id:'first',order_id:'PL-QA-1',phase:'first',amount_twd:100,finalized:true}];
 s.allocations=[{invoice_id:'first',amount_twd:100}];
 s.config.benefit_campaigns=[{id:'PL3-QA-BENEFIT-1',group_id:'qa',title:'STAR TRACE',threshold_krw:50000,
  entries:[{order_id:'PL-QA-1',batch_id:'batch-1',amount_krw:128000,hoodie_qty:1,earphone_qty:0}],
  batches:[{id:'batch-1',official_order:'OFF-1',evidence:'QA'}],
  preferences:{'qa@example.invalid':{members:['諾亞','藝俊'],accept_other:true,allow_repeat:false}},
  cards:[{id:'card-1',batch_id:'batch-1',member:'諾亞',reference:'arrival-1'}],
  tickets:[{id:'slot-1',rank:1,customer_key:'qa@example.invalid',order_ids:['PL-QA-1'],card_id:'card-1',member:'諾亞'},
   {id:'slot-2',rank:2,customer_key:'qa@example.invalid',order_ids:['PL-QA-1'],card_id:null}],
  audit:[{id:'audit-1',type:'benefit_draw',evidence:'QA',at:'2026-11-05'}],draw_command_id:'draw-1'}];
 const docs=operationsMirrorDocuments(s);
 const group=docs.find(x=>x.record_id==='benefit:PL3-QA-BENEFIT-1');
 assert.ok(group);assert.equal(group.kind,'benefit');
 const projection=group.document.star_trace;
 assert.equal(projection.qualifications[0].slots,2);
 assert.equal(projection.official_orders[0].gifts_expected,2);
 assert.equal(projection.received_cards.length,1);
 assert.equal(projection.allocation.allocated.length,1);
 assert.equal(projection.allocation.unallocated.length,1);
 assert.equal(projection.audit_events[0].event_id,'audit-1');
 assert.ok(docs[0].document.order.benefit_campaigns);
 const context=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../formal-sync-adapter.gs',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../operations-receiver.gs',import.meta.url),'utf8'),context);
 const rows=context.opsRows_({projection:group});
 const types=rows.map(x=>x.kind);
 for(const required of ['特典活動','特典客單','特典資格','特典官方訂單','特典實寄卡','特典抽籤','特典排卡','特典未配資格','特典操作稽核'])assert.ok(types.includes(required),required);
 const notion=context.opsBenefitProperties_(group.document,'ops:benefit:test');
 assert.equal(notion['資格數'].number,2);
 assert.equal(notion['預計滿額卡'].number,2);
 assert.equal(notion['實寄卡'].number,1);
 assert.equal(notion['已分配'].number,1);
 assert.equal(notion['未分配'].number,1);
});

test('STAR TRACE whole-group projection is independent and keeps all audit material',()=>{
 const s=newOperations();
 const star={group_id:'PLAVE-HYPERDRIVE-STAR-TRACE',customers:[{customer_order_id:'PL-1',lines:[{product_id:'71386',quantity:1,eligible_krw:128000}],preferences:['藝俊','諾亞','斑比','銀虎','河玟']}],official_orders:[{official_order_id:'W-1',eligible_krw:128000}],cards:[{id:'card-1',member:'藝俊'}],draw_order:['PL-1:slot:1'],draw_evidence:{seed:'test'},allocation:{allocated:[{slot_id:'PL-1:slot:1',member:'藝俊'}],unallocated:[],extra_cards:[],adjustment_history:[],packing_history:[]}};
 const docs=operationsMirrorDocuments(s,star);
 const group=docs.find(x=>x.kind==='benefit');
 assert.equal(group.record_id,'benefit:PLAVE-HYPERDRIVE-STAR-TRACE');
 assert.equal(group.document.star_trace.qualifications[0].slots,2);
 assert.equal(group.document.star_trace.qualifications[0].hoodie_gifts,1);
 assert.equal(group.document.star_trace.official_orders[0].gifts_expected,2);
 assert.equal(group.document.star_trace.official_orders[0].to_next_krw,22000);
 assert.equal(group.document.star_trace.received_cards[0].member,'藝俊');
 assert.deepEqual(group.document.star_trace.draw_evidence,{seed:'test'});
 assert.equal(operationsMirrorDocuments(s,null).some(x=>x.kind==='benefit'),false);
});
