import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {installStarTrace,readStarTrace,commandStarTrace} from '../star-trace-store.js';

const mock=()=>{
  const db=new DatabaseSync(':memory:');
  const DB={prepare(sql){let args=[];const query={bind(...v){args=v;return query},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}}};return query},
    async batch(stmts){db.exec('BEGIN');try{const result=[];for(const stmt of stmts)result.push(await stmt.run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
  return {DB,db};
};
test('STAR TRACE writes auditable D1 state and rejects stale or duplicate writes',async()=>{
  const e=mock();await installStarTrace(e);
  const customers=[{customer_order_id:'PL-QA-001',lines:[{product_id:'71386',quantity:1,eligible_krw:128000}],preferences:['藝俊','諾亞','斑比','銀虎','河玟'],accepts_duplicates:false}];
  const req={key:'startrace:qa-customers-001',version:0,action:'save_customers',payload:{customers}};
  const saved=await commandStarTrace(e,'owner:qa',req);
  assert.equal(saved.version,1);assert.equal(saved.computed.customers[0].slots,2);
  const replay=await commandStarTrace(e,'owner:qa',req);assert.equal(replay.replayed,true);
  await assert.rejects(()=>commandStarTrace(e,'owner:qa',{...req,key:'startrace:qa-customers-002'}),/重新整理/);
  const official=await commandStarTrace(e,'owner:qa',{key:'startrace:qa-official-001',version:1,action:'save_official_orders',payload:{official_orders:[{official_order_id:'WEVERSE-QA-01',eligible_krw:128000}]}});
  assert.equal(official.computed.official_orders[0].gifts_expected,2);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM pl_star_trace_events').first()).n,2);
  e.db.close();
});
