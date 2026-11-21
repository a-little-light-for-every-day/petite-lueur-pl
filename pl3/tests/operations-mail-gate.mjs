import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {newOperations} from '../operations-domain.js';
import {installOperations,loadOperations,executeOperation,sendQueuedNotice} from '../operations-store.js';

function dbEnv(){
 const db=new DatabaseSync(':memory:');
 function prepare(sql){let args=[];const q={
  bind(...a){args=a;return q},
  async first(){return db.prepare(sql).get(...args)||null},
  async all(){return {results:db.prepare(sql).all(...args)}},
  async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
 };return q;}
 return {DB:{prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const q of stmts)out.push(await q.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}},db,PL3_OPS_MAIL_ENABLED:'true'};
}
const sentId='gmail-accepted-1';
async function setup(status,{stale=false}={}){
 const env=dbEnv();await installOperations(env);
 const state=newOperations();
 state.notices.push({id:'gate-mail-1',kind:'payment',status:'sending',invoice_ids:['first:ORDER-1'],subject:'已核准付款通知'});
 state.invoices.push({id:'first:ORDER-1',order_id:'ORDER-1',phase:'first',amount_twd:170,status:'open',channel:'transfer',finalized:true,notified:false,carry_twd:0});
 env.db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(state));
 const claimed=new Date(Date.now()-(stale?10:1)*60*1000).toISOString().slice(0,19).replace('T',' ');
 env.db.prepare('INSERT INTO pl_ops_mail(id,notice_id,snapshot_json,status,approved_by,approved_at,claimed_at,gmail_message_id,gmail_thread_id,error_code,sent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run('mail-claim-1','gate-mail-1','{}',status,'owner','2026-11-21T00:00:00Z',claimed,status==='sent'?sentId:null,status==='sent'?'gmail-thread-1':null,status==='unknown'?'ACKNOWLEDGEMENT_MISSING':null,status==='sent'?'2026-11-21 09:00:00':null);
 return env;
}
const save={key:'new-group-after-mail-1',version:0,command:{type:'group_save',title:'採購分配相關團次'}};

test('already-sent delivery repairs stale sending aggregate without re-sending Gmail',async()=>{
 const env=await setup('sent');
 await assert.rejects(()=>executeOperation(save,'owner',env),/資料版本已變動/);
 let current=await loadOperations(env);
 assert.equal(current.state.notices[0].status,'sent');
 assert.equal(current.state.notices[0].gmail_message_id,sentId);
 assert.equal(current.state.invoices[0].notified,true);
 assert.equal((await sendQueuedNotice(env,'gate-mail-1',async()=>{throw Error('must not resend')})).status,'sent');
 const saved=await executeOperation({...save,version:current.version},'owner',env);
 assert.equal(saved.ok,true);
 env.db.close();
});

test('unknown delivery unblocks unrelated operation without pretending notification succeeded',async()=>{
 const env=await setup('unknown');
 await assert.rejects(()=>executeOperation(save,'owner',env),/資料版本已變動/);
 const current=await loadOperations(env);
 assert.equal(current.state.notices[0].status,'unknown');
 assert.equal(current.state.invoices[0].notified,false);
 assert.equal((await sendQueuedNotice(env,'gate-mail-1',async()=>{throw Error('must not resend')})).status,'unknown');
 assert.equal((await executeOperation({...save,version:current.version},'owner',env)).ok,true);
 env.db.close();
});

test('real in-flight Gmail claim still locks owner operations',async()=>{
 const env=await setup('sending');
 await assert.rejects(()=>executeOperation(save,'owner',env),e=>e.status===423&&/通知正在寄送/.test(e.message));
 assert.equal((await loadOperations(env)).version,0);
 assert.equal(env.db.prepare("SELECT status FROM pl_ops_mail WHERE id='mail-claim-1'").get().status,'sending');
 env.db.close();
});

test('expired Gmail claim becomes unknown, not queued or sent, then releases business lock',async()=>{
 const env=await setup('sending',{stale:true});
 await assert.rejects(()=>executeOperation(save,'owner',env),/資料版本已變動/);
 const current=await loadOperations(env);
 assert.equal(current.state.notices[0].status,'unknown');
 assert.equal(current.state.invoices[0].notified,false);
 const mail=env.db.prepare("SELECT status,error_code FROM pl_ops_mail WHERE id='mail-claim-1'").get();
 assert.equal(mail.status,'unknown');
 assert.equal(mail.error_code,'ACKNOWLEDGEMENT_MISSING');
 assert.equal((await executeOperation({...save,version:current.version},'owner',env)).ok,true);
 env.db.close();
});
