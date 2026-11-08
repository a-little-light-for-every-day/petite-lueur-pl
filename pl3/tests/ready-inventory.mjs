import test from 'node:test';
import assert from 'node:assert/strict';
import {newOperations,applyOperation} from '../operations-domain.js';
import {readyAvailable,readyPublicCatalog} from '../ready-inventory.js';
import {operationsMirrorDocuments} from '../operations-mirror.js';
const at='2026-11-08T05:00:00.000Z';
const run=(s,c,id)=>applyOperation(s,c,{now:at,id});
const stock={type:'ready_stock_save',name:'花とゆめ',variant:'2026 年刊',sku:'HANA-2026',official_order_id:'NEOWING-101',source_url:'https://example.org/item',image_url:'https://example.org/official.jpg',location:'purchased_preorder',quantity:4,price_twd:170,shipping_units:null,official_image:true,approved:true,published:true,evidence:'官方訂單與可售數已核對',confirmed:true};
function setup(){const s=newOperations();const r=run(s,stock,'stock1');return r.state;}
const claim=(quantity,id)=>({type:'ready_claim',name:'顧客',email:'buyer@example.org',items:[{stock_id:'stock1',quantity}],acceptance:{adult_confirmed:true,terms_confirmed:true}});
test('only approved PL-owned stock is public; never count self-use or supplier stock',()=>{
 const s=setup();assert.equal(readyPublicCatalog(s).items[0].available,4);
 s.ready_stock[0].approved=false;assert.equal(readyPublicCatalog(s).items.length,0);
 s.ready_stock[0].approved=true;s.ready_stock[0].published=false;assert.equal(readyPublicCatalog(s).items.length,0);
});
test('holds are atomic in the versioned state; oversell is rejected',()=>{
 let s=setup();s=run(s,claim(3),'claim1').state;
 assert.equal(readyAvailable(s,s.ready_stock[0]),1);
 assert.throws(()=>run(s,claim(2),'claim2'),/數量不足/);
 const r=run(s,claim(1),'claim3');assert.equal(readyPublicCatalog(r.state).items.length,0);
});
test('unapproved claim cancellation releases, confirmed sale does not',()=>{
 let s=setup();s=run(s,claim(2),'claim1').state;
 s=run(s,{type:'ready_claim_release',order_id:'PL3-READY-claim1',reason:'客人撤回',confirmed:true},'release1').state;
 assert.equal(readyAvailable(s,s.ready_stock[0]),4);
 assert.throws(()=>run(s,{type:'ready_claim_release',order_id:'PL3-READY-claim1',reason:'重複釋出',confirmed:true},'release2'));
 s=run(s,claim(1),'claim2').state;
 s=run(s,{type:'order_review',order_id:'PL3-READY-claim2',evidence:'已核對備貨與名額',confirmed:true},'review2').state;
 assert.equal(readyAvailable(s,s.ready_stock[0]),3);
 assert.equal(s.orders.find(x=>x.id==='PL3-READY-claim2').items[0].purchased,1);
});
test('already reserved stock cannot be reduced below claims',()=>{
 let s=setup();s=run(s,claim(3),'claim1').state;
 assert.throws(()=>run(s,{...stock,id:'stock1',quantity:2},'edit1'),/保留或已售/);
});
test('Notion and Sheets receive inventory snapshot identities without duplicating official purchase',()=>{
 let s=setup();s=run(s,claim(1),'claim1').state;
 const docs=operationsMirrorDocuments(s).filter(x=>x.kind==='inventory');
 assert.equal(docs.length,1);assert.equal(docs[0].record_id,'inventory:stock1');
 assert.equal(docs[0].document.stock.available,3);
 assert.equal(docs[0].document.claims.length,1);
 assert.equal(s.purchases.length,0);
});
