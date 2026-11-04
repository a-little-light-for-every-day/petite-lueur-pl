import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations} from '../operations-domain.js';
import {operationsMirrorDocuments} from '../operations-mirror.js';

test('STAR TRACE sync projection only changes participating customer orders',()=>{
  const state=newOperations();
  state.orders=[{id:'QA-PERK-001',email:'qa@example.invalid',status:'open',items:[],goods_twd:500},
    {id:'REAL-UNRELATED',email:'unrelated@example.invalid',status:'open',items:[],goods_twd:600}];
  const star={customers:[{customer_order_id:'QA-PERK-001',lines:[{product_id:'71375',quantity:1,eligible_krw:50000}],preferences:['藝俊','諾亞','斑比','銀虎','河玟']}],
    allocation:{allocated:[{customer_order_id:'QA-PERK-001',slot_id:'QA-PERK-001:slot:1',member:'藝俊',card_id:'card1'}],unallocated:[]}};
  const docs=operationsMirrorDocuments(state,star);
  assert.equal(docs[0].document.star_trace.allocations.length,1);
  assert.equal(Object.hasOwn(docs[1].document,'star_trace'),false);
  assert.equal(docs.filter(x=>x.kind==='order').length,2);
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
