import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation,balance,noticeContent} from '../operations-domain.js';
import {DatabaseSync} from 'node:sqlite';
import {installOperations,executeOperation,loadOperations} from '../operations-store.js';

const now='2026-11-11T01:00:00.000Z';
const email='nono31025@gmail.com';
function fixture(){
 const state=newOperations();
 for(const [id,amount] of [['candy',840],['ensky-neowing',1510],['ichueru',775],['hanayume',170]]){
  state.orders.push({id,name:'李潼恩',email,status:'confirmed',items:[{id:id+':item',name:id,quantity:1,unit_price_twd:amount}],group_id:'group'});
  state.invoices.push({id:'first:'+id,order_id:id,phase:'first',amount_twd:amount,finalized:true,status:'open',channel:'transfer',notified:false,due_at:'2026-11-13T12:00:00.000Z'});
 }
 return state;
}
const operate=(s,command,id)=>applyOperation(s,command,{id,now}).state;
const historical={type:'legacy_mail_record',confirmed:true,invoice_id:'first:hanayume',to:email,amount_twd:170,subject:'舊系統通知',body:'您好，商品款 NT$170，請於舊期限付款。',sent_at:'2026-11-10T15:32:00.000Z',gmail_message_id:'1a1c617252046347',evidence:'個人帳戶寄件備查，內容及期限與PL3不同'};

test('legacy mail preserved independently and consolidated draft does not duplicate receivables',()=>{
 let s=fixture();s=operate(s,historical,'legacy-mail-1');
 assert.equal(s.notices[0].status,'sent');assert.equal(s.invoices[3].notified,false);
 assert.throws(()=>operate(s,historical,'legacy-mail-2'),/不可重複/);
 const ids=s.invoices.map(b=>b.id);
 s=operate(s,{type:'notice_draft',invoice_ids:ids,supersede_legacy_notice_ids:['legacy-mail-1']},'consolidated-1');
 assert.equal(s.notices.length,2);
 assert.equal(s.notices[0].superseded_by,'consolidated-1');
 assert.deepEqual(s.notices[1].order_ids,['candy','ensky-neowing','ichueru','hanayume']);
 assert.match(s.notices[1].body,/NT\$3,295/);
 assert.equal(s.invoices.reduce((sum,b)=>sum+balance(s,b),0),3295);
 assert.equal(s.notices[1].status,'draft');
 assert.throws(()=>operate(s,{type:'notice_draft',invoice_ids:ids,supersede_legacy_notice_ids:['legacy-mail-1']},'duplicate'),/已被取代/);
 s=operate(s,{type:'notice_cancel',notice_id:'consolidated-1'},'cancel');
 assert.equal(s.notices[0].superseded_by,undefined);
 assert.equal(s.notices[0].gmail_message_id,historical.gmail_message_id);
});

test('reject unrelated legacy email, wrong amount and unrelated invoice link',()=>{
 const s=fixture();
 assert.throws(()=>operate(s,{...historical,to:'other@example.com'},'bad-email'),/不符/);
 assert.throws(()=>operate(s,{...historical,amount_twd:171},'bad-amount'),/不符/);
 const withLegacy=operate(s,historical,'legacy-mail-1');
 assert.throws(()=>operate(withLegacy,{type:'notice_draft',invoice_ids:['first:candy'],supersede_legacy_notice_ids:['legacy-mail-1']},'bad-link'),/不屬於/);
});

test('isolated D1 persistence: historic Gmail evidence and consolidated draft survive reload, no mail queued',async()=>{
 const db=new DatabaseSync(':memory:');
 function prepare(sql){let args=[];const q={bind(...a){args=a;return q},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}}};return q}
 const env={DB:{prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const q of stmts)out.push(await q.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
 await installOperations(env);
 db.prepare("UPDATE pl_ops_state SET document_json=? WHERE id='main'").run(JSON.stringify(fixture()));
 const saved=await executeOperation({key:'legacy-mail-command',version:0,command:historical},'owner',env);
 assert.equal(saved.result.recorded,true);
 let s=(await loadOperations(env)).state;
 assert.equal(s.notices[0].gmail_message_id,historical.gmail_message_id);
 const billIds=s.invoices.map(b=>b.id);
 const consolidated=await executeOperation({key:'consolidated-command',version:1,command:{type:'notice_draft',invoice_ids:billIds,supersede_legacy_notice_ids:[s.notices[0].id]}},'owner',env);
 assert.equal(consolidated.result.notice_id,'consolidated-command');
 s=(await loadOperations(env)).state;
 assert.equal(s.notices.find(n=>n.kind==='legacy-payment').superseded_by,'consolidated-command');
 assert.equal(s.notices.find(n=>n.id==='consolidated-command').status,'draft');
 assert.equal(s.invoices.reduce((sum,b)=>sum+balance(s,b),0),3295);
 assert.equal(db.prepare('SELECT COUNT(*) count FROM pl_ops_mail').get().count,0);
 await assert.rejects(()=>executeOperation({key:'duplicate-legacy-command',version:2,command:historical},'owner',env),/不可重複/);
 db.close();
});
