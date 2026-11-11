import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,newOperations} from '../operations-domain.js';
import {entityKinds} from '../operations-store.js';
import {installOperations,executeOperation,loadOperations} from '../operations-store.js';
import {DatabaseSync} from 'node:sqlite';

const now='2026-11-11T11:00:00.000Z';
const magazine={type:'stock_lot_record',confirmed:true,owner_type:'pl_stock',
 lot_id:'NW9162348:HANAYUME22:PL',sku:'HANAYUME22-NEOWING',name:'《花とゆめ》2026年第22號',
 source_order:'10115389845',shipment_reference:'NW9162348',quantity_purchased:6,quantity_reserved:2,
 shipping_units:18,goods_cost_cents:70928,japan_cost_cents:0,international_cost_cents:61800,
 packaging_cost_cents:null,tax_cost_cents:null,received_quantity:0,saleable_quantity:0,
 evidence:'Neowing 官方訂購單 10115389845；NW9162348 NT$1,717／50 份分攤；Notion 商品頁已核對'};
const set={...magazine,lot_id:'NW9162348:TAMON17:PL',sku:'TAMON17-FROMAGEE-SET-123270821',name:'《現在的是哪一個多聞！？》第17集 Fromagee Complete Set',source_order:'123270821',quantity_purchased:1,quantity_reserved:0,shipping_units:4,goods_cost_cents:67200,international_cost_cents:13700};

test('private stock lots store actual cents with unknown fees and zero saleable stock; no billing or notices',()=>{
 const original=newOperations();
 original.invoices.push({id:'first',amount_twd:2400,finalized:true});
 original.notices.push({id:'mail',status:'sent'});
 let state=applyOperation(original,magazine,{id:'stock1',now}).state;
 ({state}=applyOperation(state,set,{id:'stock2',now}));
 assert.equal(state.stock_lots.length,2);
 assert.equal(state.stock_lots[0].known_cost_cents,132728);
 assert.equal(state.stock_lots[1].known_cost_cents,80900);
 assert.equal(state.stock_lots.reduce((x,l)=>x+l.shipping_units,0),22);
 assert.equal(state.stock_lots.reduce((x,l)=>x+l.international_cost_cents,0),75500);
 assert.equal(state.stock_lots[0].quantity_reserved,2);
 for(const lot of state.stock_lots){
  assert.equal(lot.received_quantity,0);
  assert.equal(lot.saleable_quantity,0);
  assert.equal(lot.publicly_listed,false);
  assert.equal(lot.status,'in_transit');
  assert.equal(lot.packaging_cost_cents,null);
  assert.equal(lot.tax_cost_cents,null);
 }
 assert.deepEqual(state.invoices,original.invoices);
 assert.deepEqual(state.notices,original.notices);
 assert.deepEqual(state.products,original.products);
 assert.ok(entityKinds.includes('stock_lots'));
});

test('duplicate source, wrong costs, reserves, or premature stock availability are rejected',()=>{
 const state=applyOperation(newOperations(),magazine,{id:'stock1',now}).state;
 const invalid=[
  [magazine,/已登錄/],
  [{...magazine,lot_id:'different'},/已登錄/],
  [{...set,quantity_reserved:2},/暫留數量/],
  [{...set,goods_cost_cents:-1},/金額/],
  [{...set,goods_cost_cents:672.5},/金額/],
  [{...set,packaging_cost_cents:0},/包材/],
  [{...set,tax_cost_cents:0},/稅費/],
  [{...set,saleable_quantity:1},/可售庫存/],
  [{...set,received_quantity:1},/抵台/],
  [{...set,owner_type:'other'},/PL 備貨/],
  [{...set,evidence:''},/依據/],
  [{...set,confirmed:false},/確認/]
 ];
 for(const [command,pattern]of invalid)assert.throws(()=>applyOperation(state,command,{id:'invalid',now}),pattern);
 assert.equal(state.stock_lots.length,1);
});

test('stock lot survives an isolated D1 reload and idempotent request retry without adding a bill or notice',async()=>{
 const db=new DatabaseSync(':memory:');
 function prepare(sql){let args=[];const q={bind(...a){args=a;return q},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}};return q;}
 const env={DB:{prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());db.exec('COMMIT');return out}catch(err){db.exec('ROLLBACK');throw err}}}};
 await installOperations(env);
 const command={key:'NW9162348-magazine-save',version:0,command:magazine};
 const saved=await executeOperation(command,'owner',env);
 assert.equal(saved.version,1);
 assert.equal(saved.result.saleable_quantity,0);
 const reload=await loadOperations(env);
 assert.equal(reload.state.stock_lots.length,1);
 assert.deepEqual(reload.state.stock_lots[0].known_cost_cents,132728);
 assert.equal(reload.state.orders.length,0);
 assert.equal(reload.state.invoices.length,0);
 assert.equal(reload.state.notices.length,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM pl_ops_mail").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM pl_ops_entities WHERE kind='stock_lots'").get().n,1);
 const replay=await executeOperation(command,'owner',env);
 assert.equal(replay.replayed,true);
 assert.equal((await loadOperations(env)).state.stock_lots.length,1);
 db.close();
});
