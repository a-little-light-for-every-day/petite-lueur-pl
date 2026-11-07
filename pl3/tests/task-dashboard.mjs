import test from 'node:test';
import assert from 'node:assert/strict';
import {taskCategory,taskOrderId,taskDashboardModel} from '../console/task-dashboard-model.js';

const state={
 orders:[{id:'PL-1',name:'甲',items:[{id:'L-1'},{id:'L-2'}]},{id:'PL-2',name:'乙',items:[{id:'L-3'}]}],
 invoices:[{id:'B-1',order_id:'PL-1',phase:'first'},{id:'B-2',order_id:'PL-1',phase:'second'},{id:'B-old',order_id:'PL-2',legacy_settlement:{recognized_twd:100}}],
 reports:[{id:'R-1',order_id:'PL-1'}],service_requests:[],notices:[{id:'N-1',order_ids:['PL-1','PL-2']}],
};
const task=(type,id,title)=>({id:type+':'+id,type,object_id:id,title,detail:'細節',priority:2});

test('waiting stages are separate from main work, while payment review stays actionable',()=>{
 assert.equal(taskCategory(state,task('warehouse','L-1','等待海外倉入庫')),'waiting');
 assert.equal(taskCategory(state,task('warehouse','L-2','轉運品等待海外倉入庫')),'waiting');
 assert.equal(taskCategory(state,task('invoice','B-1','等待付款')),'waiting');
 assert.equal(taskCategory(state,task('invoice','B-1','付款已逾期')),'action');
 assert.equal(taskCategory(state,task('report','R-1','客人付款回報待核帳')),'action');
 assert.equal(taskCategory(state,task('invoice','B-old','帳款金額待確認')),'historical');
});

test('separate historic evidence from live alerts without erasing raw records',()=>{
 const raw=[task('invoice','B-1','帳款金額待確認'),task('invoice','B-2','帳款金額待確認'),task('warehouse','L-1','等待海外倉入庫'),task('warehouse','L-2','等待海外倉入庫'),task('invoice','B-old','歷史已核對款項待補入帳證據'),task('report','R-1','客人付款回報待核帳')];
 const before=JSON.stringify({state,raw});
 const m=taskDashboardModel(state,raw);
 assert.deepEqual([m.action.taskCount,m.waiting.taskCount,m.historical.taskCount],[3,2,1]);
 assert.deepEqual([m.action.orderCount,m.waiting.orderCount,m.historical.orderCount],[1,1,1]);
 assert.equal(m.action.groups.length,1);
 assert.equal(m.action.groups[0].tasks.length,3);
 assert.deepEqual(m.action.groups[0].tasks.map(t=>t.id),[raw[0].id,raw[1].id,raw[5].id]);
 assert.equal(m.rawCount,raw.length);
 assert.equal(JSON.stringify({state,raw}),before);
});

test('a cross-customer notice or official purchase is not assigned to one customer',()=>{
 const purchase=task('purchase','P-1','實際刷卡金額待核對');
 const notice=task('notice','N-1','待審通知');
 assert.equal(taskOrderId(state,purchase),null);
 assert.equal(taskOrderId(state,notice),null);
 const m=taskDashboardModel(state,[purchase,notice]);
 assert.equal(m.action.taskCount,2);
 assert.equal(m.action.orderCount,0);
 assert.equal(m.action.groups.length,2);
});
