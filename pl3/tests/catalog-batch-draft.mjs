import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation} from '../operations-domain.js';
import {parseDraftCatalogJSON} from '../catalog-batch-draft.js';

const groupId='NEOWING-KIMISHINU-261104';
const item=n=>({id:'NEOGDS-'+n,group_id:groupId,name:'測試預購商品 '+n,
 price_twd:240,source_url:'https://www.neowing.co.jp/detail/'+n});
const apply=(state,command)=>applyOperation(state,command,{id:'TEST-ID',now:'2026-11-04T01:00:00Z'});

test('create group with original ID and reject accidental overwrite',()=>{
 const initial=newOperations();
 const {state}=apply(initial,{type:'group_save',id:groupId,title:'《與妳相戀到生命盡頭》預購',
  source_url:'https://www.neowing.co.jp/series/6851',status:'draft',create_only:true});
 assert.equal(state.groups[0].id,groupId);
 assert.equal(state.groups[0].status,'draft');
 assert.throws(()=>apply(state,{type:'group_save',id:groupId,title:'覆蓋',create_only:true}),/禁止覆寫/);
 assert.equal(state.groups[0].title,'《與妳相戀到生命盡頭》預購');
});

test('43 drafts import idempotently and never become public or confirmed',()=>{
 const {state:groupState}=apply(newOperations(),{type:'group_save',id:groupId,
  title:'43款新團次',status:'draft',create_only:true});
 const parsed=parseDraftCatalogJSON(JSON.stringify(Array.from({length:43},(_,n)=>item(n+1))),groupId);
 assert.equal(parsed.products.length,43);
 assert.equal(parsed.missingShipping,43);
 assert.equal(parsed.missingImage,43);
 const first=apply(groupState,{type:'catalog_batch_draft',group_id:groupId,
  confirmed:true,products:parsed.products});
 assert.deepEqual(first.result,{imported:43,skipped:0});
 assert.equal(first.state.products.length,43);
 assert.ok(first.state.products.every(p=>!p.published&&!p.shipping_units_confirmed&&!p.image_official));
 assert.equal(first.state.products[0].id,'catalog:NEOGDS-1');
 assert.equal(first.state.products[0].group_id,groupId);
 const again=apply(first.state,{type:'catalog_batch_draft',group_id:groupId,
  confirmed:true,products:parsed.products});
 assert.deepEqual(again.result,{imported:0,skipped:43});
 assert.equal(again.state.products.length,43);
 assert.equal(again.state.orders.length,0);
 assert.equal(again.state.notices.length,0);
});

test('reject mismatched group, duplicate SKU, changed source record, and public flag',()=>{
 const sample=item(1);
 assert.throws(()=>parseDraftCatalogJSON(JSON.stringify([sample,{...sample}]),groupId),/重複/);
 assert.throws(()=>parseDraftCatalogJSON(JSON.stringify([{...sample,group_id:'WRONG'}]),groupId),/團次 ID/);
 assert.throws(()=>parseDraftCatalogJSON(JSON.stringify([{...sample,published:true}]),groupId),/草稿/);
 assert.equal(parseDraftCatalogJSON(JSON.stringify([{...sample,source_url:'https://www.animate-onlineshop.jp/'}]),groupId).products[0].source_url,'https://www.animate-onlineshop.jp/');
 const {state:groupState}=apply(newOperations(),{type:'group_save',id:groupId,title:'預購',status:'draft'});
 const first=apply(groupState,{type:'catalog_batch_draft',group_id:groupId,confirmed:true,products:[sample]});
 assert.throws(()=>apply(first.state,{type:'catalog_batch_draft',group_id:groupId,confirmed:true,
  products:[{...sample,price_twd:999}]}),/人工核對/);
 assert.throws(()=>apply(first.state,{type:'catalog_batch_draft',group_id:groupId,confirmed:true,
  products:[{...item(2),official_sku:sample.id}]}),/規格重複/);
 assert.equal(first.state.products.length,1);
});
