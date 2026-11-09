import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {newOperations} from '../operations-domain.js';
import {qaPaymentBillForCustomer,qaPaymentBillSet,qaPaymentBillStatus} from '../qa-payment-bill.js';

function fixture(){
 const db=new DatabaseSync(':memory:');
 const prepare=sql=>{let args=[];const q={bind(...values){args=values;return q},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}},async first(){return db.prepare(sql).get(...args)||null}};return q;};
 const env={DB:{prepare},PL3_QA_PAYMENT_ENABLED:'true',PL3_QA_PAYMENT_EMAIL:'pl3-qa@example.test'};
 const state=newOperations();state.config.payment_accounts={bank_transfer:'12345678901234',ctbc_cash:'987654321012'};
 return{db,env,state};
}

test('QA-only payment bill supports each requested state without creating a real order or invoice',async()=>{
 const{db,env,state}=fixture();
 for(const stage of ['not_notified','notified','settled','cancelled','overdue']){
  await qaPaymentBillSet(env,stage,'2026-11-09T00:00:00.000Z');
  const customer=await qaPaymentBillForCustomer(env,state,env.PL3_QA_PAYMENT_EMAIL,Date.parse('2026-11-09T01:00:00.000Z'));
  assert.equal(customer.id,'PL3-QA-PAYMENT-DISPLAY');
  const bill=customer.invoices[0];
  if(stage==='notified')assert.deepEqual(bill.payment_options.map(x=>x.bank_code),['812','822','822']);
  else assert.deepEqual(bill.payment_options,[],stage);
  if(stage==='settled')assert.equal(bill.outstanding_twd,0);
  if(stage==='cancelled')assert.equal(customer.status,'cancelled');
 }
 assert.equal((await qaPaymentBillStatus(env)).bill.stage,'overdue');
 assert.deepEqual(await qaPaymentBillForCustomer(env,state,'someone-else@example.test'),null);
 assert.equal(state.orders.length,0);assert.equal(state.invoices.length,0);
 db.close();
});

test('QA bill stays unavailable unless the server QA gate and test identity are configured',async()=>{
 const{db,env,state}=fixture();env.PL3_QA_PAYMENT_ENABLED='false';
 await assert.rejects(qaPaymentBillSet(env,'notified'),/未啟用/);
 assert.deepEqual(await qaPaymentBillForCustomer(env,state,env.PL3_QA_PAYMENT_EMAIL),null);
 db.close();
});
