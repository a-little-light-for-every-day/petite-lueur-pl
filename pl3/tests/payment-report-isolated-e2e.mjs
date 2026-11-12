import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation,balance} from '../operations-domain.js';
import {paymentInstructionsFor} from '../payment-instructions.js';

// Entirely local, synthetic ledger: no D1 writes, bank calls, Gmail, or customer notifications.
const NOW='2026-11-04T01:00:00.000Z';
const METHODS=['銀行匯款','中國信託銀行轉帳','中國信託無卡存款'];
function scenario(){
 let state=newOperations(),counter=0;
 const go=command=>{
  const result=applyOperation(state,command,{id:'qa-'+(++counter),now:NOW});
  state=result.state;return result.result;
 };
 const group=go({type:'group_save',title:'隔離驗收團',payment_due_at:'2026-11-05T12:00:00Z'}).group_id;
 const order=go({type:'order_save',id:'PL-QA-REPORT',name:'模擬客人',email:'qa-buyer@example.test',group_id:group,items:[{name:'測試商品',sku:'QA-1',quantity:1,unit_price_twd:321,shipping_units:1}]}).order_id;
 go({type:'close_group',group_id:group});
 go({type:'payment_accounts_config',bank_transfer:'12345678901234',ctbc_cash:'987654321012',confirmed:true});
 const bill=state.invoices[0];
 bill.notified=true; // Simulate a successfully sent payment notice; never send one.
 return{go,order,bill,get state(){return state}};
}
for(const method of METHODS){
 test('isolated payment report -> owner confirmation: '+method,()=>{
  const f=scenario(),s=f.state,b=f.bill;
  assert.equal(balance(s,b),321);
  assert.deepEqual(paymentInstructionsFor(s,s.orders[0],b,Date.parse(NOW)).map(x=>x.method),METHODS);
  const report={type:'payment_report',order_id:f.order,authenticated_email:'qa-buyer@example.test',phase:'first',amount_twd:321,method,paid_at:'2026-11-04T01:23:00.000Z',last5:method==='中國信託無卡存款'?'':'12345',note:'synthetic QA only'};
  f.go(report);
  assert.equal(f.state.reports.length,1);
  assert.equal(f.state.reports[0].method,method);
  assert.equal(f.state.reports[0].status,'pending');
  assert.equal(balance(f.state,b),321,'customer report alone must not settle invoice');
  assert.throws(()=>f.go(report),/相同回報/, 'duplicate pending report must fail');
  f.go({type:'receipt_confirm',customer_email:'qa-buyer@example.test',amount_twd:321,kind:'bank_confirmed',transaction_id:'QA-SYNTHETIC-'+method,evidence:'simulated owner reconciliation only',confirmed:true,report_id:f.state.reports[0].id,allocations:[{invoice_id:b.id,amount_twd:321}]});
  assert.equal(balance(f.state,b),0);
  assert.equal(f.state.reports[0].status,'confirmed');
  assert.deepEqual(paymentInstructionsFor(f.state,f.state.orders[0],b,Date.parse(NOW)),[],'settled invoice must hide payment accounts');
  assert.equal(f.state.notices.filter(n=>n.kind==='first-payment-confirmed').every(n=>n.status==='draft'),true,'confirmation email remains unsent draft');
 });
}
