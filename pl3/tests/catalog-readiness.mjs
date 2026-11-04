import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogReadiness} from '../catalog-readiness.js';
import {legacyOperationsCatalog} from '../storefront-handoff.js';
test('readiness matches public catalog and distinguishes expired open groups and missing products',()=>{
 const groups=[{id:'live',title:'live',status:'open',deadline:'2099-01-01'}, {id:'missing',status:'open',deadline:'2099-01-01'}, {id:'draft',status:'open',deadline:'2099-01-01'}, {id:'expired',status:'open',deadline:'2020-01-01'}, {id:'closed',status:'closed',deadline:'2099-01-01'}];
 const products=[{id:'A',group_id:'live',published:true,status:'available',price_twd:10},{id:'B',group_id:'draft',published:false,status:'available',shipping_units_confirmed:false},{id:'C',group_id:'expired',published:true,status:'available'},{id:'D',group_id:'closed',published:true,status:'available'}];
 const s={groups,products};const r=catalogReadiness(s);
 assert.equal(r.public_groups,1);assert.equal(r.public_products,1);assert.equal(r.expired,1);assert.equal(r.open_blocked.length,2);
 assert.equal(r.groups.find(g=>g.id==='missing').reason,'尚未建立商品');
 assert.equal(r.groups.find(g=>g.id==='draft').shipping_pending,1);
 assert.equal(r.public_products,legacyOperationsCatalog(s).products.length);
 assert.equal(groups[3].status,'open');assert.equal(products[1].published,false);
});
