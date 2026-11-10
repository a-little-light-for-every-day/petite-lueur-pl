import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {qaNoticeBackfillStart,qaNoticeBackfillSet,qaNoticeBackfillStatus} from '../qa-notice-backfill.js';

test('isolated online QA backfill persists sent evidence and rejects duplicates without touching production tables',async()=>{
 const db=new DatabaseSync(':memory:');
 const env={DB:{prepare(sql){let args=[];const stmt={bind(...values){args=values;return stmt},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}};return stmt}}};
 const start=await qaNoticeBackfillStart(env);
 assert.equal(start.notice.status,'draft');
 const command={gmail_message_id:'qa-gmail-43-test-001',sent_at:'2026-11-04T00:30:00Z',evidence:'isolated QA evidence; no real Gmail message',confirmed:true};
 const result=await qaNoticeBackfillSet(env,command);
 assert.equal(result.notice.status,'sent');
 assert.equal(result.notice.gmail_message_id,command.gmail_message_id);
 assert.equal(result.notice.sent_at,'2026-11-04T00:30:00.000Z');
 assert.equal((await qaNoticeBackfillStatus(env)).notice.evidence,command.evidence);
 await assert.rejects(()=>qaNoticeBackfillSet(env,command),/不能重複/);
 assert.equal((await qaNoticeBackfillStart(env)).already_completed,true);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
 assert.deepEqual(tables,['pl3_qa_notice_backfill']);
 db.close();
});
