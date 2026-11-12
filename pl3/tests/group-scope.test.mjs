import test from 'node:test';
import assert from 'node:assert/strict';
import {groupScope} from '../console/group-scope.js';

const sample=()=>({
 groups:[{id:'group-a',title:'A'},{id:'group-b',title:'B'}],
 orders:[{id:'a1',group_id:'group-a',items:[{id:'item-a'}]},{id:'b1',group_id:'group-b',items:[{id:'item-b'}]}],
 products:[{id:'prod-a',group_id:'group-a'},{id:'prod-b',group_id:'group-b'}],
 invoices:[{id:'invoice-a',order_id:'a1'},{id:'invoice-b',order_id:'b1'}],
 notices:[{id:'notice-a',order_ids:['a1'],invoice_ids:[]},{id:'notice-b',order_ids:['b1'],invoice_ids:[]},{id:'notice-both',order_ids:['a1','b1'],invoice_ids:['invoice-a','invoice-b']},{id:'owner-test',order_ids:[],invoice_ids:[]}],
 reports:[{id:'report-a',order_id:'a1'},{id:'report-b',order_id:'b1'}],
 purchases:[{id:'purchase-both',items:[{order_id:'a1',item_id:'item-a'},{order_id:'b1',item_id:'item-b'}]}],
 shipments:[{id:'shipment-both',items:[{order_id:'a1',item_id:'item-a'},{order_id:'b1',item_id:'item-b'}]}],
 allocations:[{id:'allocation-a',receipt_id:'receipt-both',invoice_id:'invoice-a'},{id:'allocation-b',receipt_id:'receipt-both',invoice_id:'invoice-b'}],
 receipts:[{id:'receipt-both',amount_twd:1000},{id:'unallocated',amount_twd:500}],
 service_requests:[{id:'service-a',order_id:'a1'},{id:'service-unlinked'},{id:'service-b',order_id:'b1'}],
 config:{benefit_campaigns:[{id:'campaign-a',group_id:'group-a'},{id:'campaign-b',group_id:'group-b'}]},
 history:[{id:'history-a',result:{order_id:'a1'}},{id:'history-b',result:{order_id:'b1'}},{id:'history-global',result:{}}]
});

test('selected group limits all linked operations lists, keeping joint records whole',()=>{
 const s=sample(),v=groupScope(s,'group-a');
 for(const [field,expected] of Object.entries({orders:['a1'],products:['prod-a'],invoices:['invoice-a'],reports:['report-a'],notices:['notice-a','notice-both'],purchases:['purchase-both'],shipments:['shipment-both'],receipts:['receipt-both'],serviceRequests:['service-a'],groups:['group-a'],campaigns:['campaign-a'],history:['history-a']})){
  assert.deepEqual(v[field].map(x=>x.id),expected,field);
 }
 assert.equal(v.receiptIsCrossGroup(s.receipts[0]),true);
 assert.equal(v.purchases[0].items.length,2,'joint official order item allocations are not rewritten');
 assert.equal(v.matchesTask({type:'purchase',object_id:'item-a'}),true);
 assert.equal(v.matchesTask({type:'purchase',object_id:'item-b'}),false);
 assert.equal(v.matchesTask({type:'report',object_id:'report-a'}),true);
 assert.equal(v.matchesTask({type:'notice',object_id:'notice-b'}),false);
 assert.equal(v.matchesTask({type:'credit',object_id:'unallocated'}),false);
 assert.equal(v.matchesTask({type:'star_trace',object_id:'group-a'}),true);
 assert.equal(s.orders.length,2,'selection never changes live state');
});

test('all groups keeps global records and tasks',()=>{
 const s=sample(),v=groupScope(s,'');
 assert.equal(v.orders.length,2);
 assert.equal(v.notices.length,4);
 assert.equal(v.receipts.length,2);
 assert.equal(v.serviceRequests.length,3);
 assert.equal(v.history.length,3);
 assert.equal(v.matchesTask({type:'unmatched',object_id:'anything'}),true);
});
