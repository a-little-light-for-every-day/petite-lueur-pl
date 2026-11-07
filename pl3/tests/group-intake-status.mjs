import test from 'node:test';
import assert from 'node:assert/strict';
import {BENEFIT_GROUP} from '../benefit-checkout.js';
import {groupIntakeLabel,groupSettlementLabel,groupIntakeExpired} from '../console/group-status.js';
import {applyOperation,newOperations} from '../operations-domain.js';

const deadline='2026-11-06T02:00:00.000Z'; // 11/06 10:00 Taiwan
const after=Date.parse('2026-11-08T02:00:00.000Z');

test('intake cutoff and final settlement remain separate for STAR TRACE',()=>{
 const g={id:BENEFIT_GROUP,status:'open',deadline,sale_phase:'awaiting_second'};
 assert.equal(groupIntakeExpired(g,after),true);
 assert.equal(groupIntakeLabel(g,after),'收單已截止・二販處理中');
 assert.equal(groupSettlementLabel(g),'等待二販核實');
 assert.equal(groupIntakeLabel(g,Date.parse('2026-11-06T01:59:59Z')),'收單中');
 assert.equal(groupIntakeLabel({...g,sale_phase:'finished'},after),'收單已截止・待結案');
 assert.equal(groupSettlementLabel({...g,sale_phase:'finished'}),'二販已核實・待結案');
 assert.equal(groupIntakeLabel({...g,status:'closed'},after),'收單已截止・已結案');
});

test('ordinary expired and draft groups never appear to accept new orders',()=>{
 assert.equal(groupIntakeLabel({id:'test',status:'open',deadline},after),'收單已截止・待結案');
 assert.equal(groupIntakeLabel({id:'test',status:'open',deadline:null},after),'未開放接單・截止待設定');
 assert.equal(groupIntakeLabel({id:'test',status:'draft',deadline},after),'草稿');
 assert.equal(groupIntakeLabel({id:'test',status:'cancelled',deadline},after),'流團');
});

test('STAR TRACE cannot auto-finalize or bypass finalization flow via group editor',()=>{
 const now='2026-11-08T02:00:00.000Z';
 const save={type:'group_save',id:BENEFIT_GROUP,title:'STAR TRACE',status:'open',deadline,payment_due_at:'2026-11-09T00:00:00.000Z'};
 const initial=applyOperation(newOperations(),save,{id:'create',now}).state;
 assert.throws(()=>applyOperation(initial,{...save,auto_close:true},{id:'auto',now}),/不支援到期自動/);
 assert.throws(()=>applyOperation(initial,{...save,status:'closed'},{id:'manual',now}),/核實一販與二販結果/);
 const waiting=structuredClone(initial);
 waiting.groups[0].sale_phase='awaiting_second';
 assert.throws(()=>applyOperation(waiting,{...save,status:'closed'},{id:'premature',now}),/核實一販與二販結果/);
 const finished=structuredClone(waiting);
 finished.groups[0].sale_phase='finished';
 assert.throws(()=>applyOperation(finished,{...save,status:'closed'},{id:'skip-bill',now}),/結單／產生一補草稿/);
 assert.equal(finished.groups[0].status,'open');
 assert.equal(finished.invoices.length,0);
 assert.equal(finished.notices.length,0);
});
