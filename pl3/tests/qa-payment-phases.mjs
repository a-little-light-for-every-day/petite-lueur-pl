import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {qaPaymentStart,qaPaymentStatus} from '../qa-payment-phases.js';

function isolated(){
  const db=new DatabaseSync(':memory:');
  const prepare=(sql)=>{let args=[];const q={bind(...v){args=v;return q},
    async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},
    async all(){return {results:db.prepare(sql).all(...args)}}};return q;};
  return {db,env:{DB:{prepare,async batch(stmts){db.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},
    PL3_SYNC_ALLOW_QA:'true',PL3_SYNC_WEBHOOK_SECRET:'test-secret',
    PL3_SYNC_WEBHOOK_URL:'https://script.google.com/macros/s/syntheticQA/exec'}};
}
test('owner rehearsal persists exactly four QA-only phase snapshots and retries without duplication',async()=>{
  const {db,env}=isolated();
  await qaPaymentStart(env);await qaPaymentStart(env);
  const {rows,group_id}=await qaPaymentStatus(env);
  assert.equal(group_id,'PL3-QA-PAYMENTS');assert.equal(rows.length,4);
  assert.deepEqual(rows.map(x=>x.amounts.stage),['first_invoiced','first_partial','second_invoiced','second_settled']);
  assert.deepEqual(rows.map(x=>[x.amounts.invoice_twd,x.amounts.received_twd,x.amounts.outstanding_twd,x.amounts.carry_twd]),
    [[890,0,890,0],[890,800,90,90],[228,0,228,90],[228,228,0,90]]);
  assert.equal(db.prepare('SELECT count(*) n FROM pl3_qa_payment_events').get().n,4);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='pl_ops_state'").get().n,0);
  db.close();
});
test('QA endpoints fail closed without explicit QA gate',async()=>{
  const {db,env}=isolated();env.PL3_SYNC_ALLOW_QA='false';
  await assert.rejects(qaPaymentStart(env),/not configured/);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='pl3_qa_payment_events'").get().n,0);
  db.close();
});
