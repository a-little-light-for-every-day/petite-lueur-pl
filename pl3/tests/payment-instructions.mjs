import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation} from '../operations-domain.js';
import {paymentInstructionsFor} from '../payment-instructions.js';

const NOW='2026-11-07T05:00:00.000Z';
const BANK='12345678901234',CTBC='987654321012'; // Fake, non-production fixtures.
function fixture(){
 let state=newOperations();
 const configured=applyOperation(state,{type:'payment_accounts_config',bank_transfer:BANK,ctbc_cash:CTBC,confirmed:true},{now:NOW,id:'test-config'});
 state=configured.state;
 const order={id:'PL-TEST',email:'buyer@example.com',status:'accepted',items:[]};
 const bill={id:'first:PL-TEST',order_id:order.id,phase:'first',amount_twd:500,channel:'transfer',finalized:true,notified:true,status:'open',due_at:'2026-11-08T05:00:00.000Z'};
 state.orders.push(order);state.invoices.push(bill);
 return{state,order,bill,configResult:configured.result};
}
test('admin-only account configuration stores two accounts without leaking full numbers to history',()=>{
 const{state,configResult}=fixture();
 assert.equal(state.config.payment_accounts.bank_transfer,BANK);
 assert.equal(state.config.payment_accounts.ctbc_cash,CTBC);
 assert.equal(configResult.bank_transfer_last4,'1234');
 assert.ok(!JSON.stringify(state.history).includes(BANK));
 assert.ok(!JSON.stringify(state.history).includes(CTBC));
 for(const bad of [{type:'payment_accounts_config',bank_transfer:BANK,ctbc_cash:'123',confirmed:true},{type:'payment_accounts_config',bank_transfer:BANK,ctbc_cash:CTBC,confirmed:false}]){
  assert.throws(()=>applyOperation(state,bad,{id:'bad',now:NOW}),/帳號|確認/);
 }
});
test('authenticated order view can offer only that order’s current, notified, unpaid invoice',()=>{
 const{state,order,bill}=fixture();
 const options=paymentInstructionsFor(state,order,bill,Date.parse(NOW));
 assert.deepEqual(options.map(o=>[o.method,o.bank_code,o.account]),[['銀行匯款','812',BANK],['中國信託銀行轉帳','822',CTBC],['中國信託無卡存款','822',CTBC]]);
 assert.deepEqual(paymentInstructionsFor(state,{...order,id:'NOT-OWNED'},bill,Date.parse(NOW)),[]);
 for(const status of ['cancelled','excluded','completed','waitlisted','review_pending'])assert.deepEqual(paymentInstructionsFor(state,{...order,status},bill,Date.parse(NOW)),[]);
 for(const change of [{notified:false},{finalized:false},{status:'void'},{channel:'cod'},{due_at:'2026-11-06T05:00:00Z'},{due_at:'invalid'}]){
  assert.deepEqual(paymentInstructionsFor(state,order,{...bill,...change},Date.parse(NOW)),[],JSON.stringify(change));
 }
 assert.deepEqual(paymentInstructionsFor({...state,allocations:[{invoice_id:bill.id,amount_twd:500}]},order,bill,Date.parse(NOW)),[]);
 assert.deepEqual(paymentInstructionsFor({...state,config:{}},order,bill,Date.parse(NOW)),[]);
});
test('only configured, valid accounts are shown',()=>{
 const{state,order,bill}=fixture();
 state.config.payment_accounts.ctbc_cash='bad';
 assert.deepEqual(paymentInstructionsFor(state,order,bill,Date.parse(NOW)).map(x=>x.bank_code),['812']);
});
