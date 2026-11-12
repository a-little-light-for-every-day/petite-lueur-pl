import test from 'node:test';
import assert from 'node:assert/strict';
import{newOperations,applyOperation}from '../operations-domain.js';
import{publicOperationsCatalog}from '../operations-store.js';
import{legacyOperationsCatalog}from '../storefront-handoff.js';
import{PRODUCT_CATEGORIES,inferProductCategory}from '../product-category.js';
const NOW='2026-11-12T12:00:00.000Z';
function fixture(){
 let state=newOperations(),seq=0;
 const go=cmd=>{const x=applyOperation(state,cmd,{id:'category-test-'+(++seq),now:NOW});state=x.state;return x.result;};
 const group='MAG-23';
 go({type:'group_save',id:group,title:'《マーガレット》2026年第23號',status:'open',deadline:'2099-11-15T14:00:00.000Z',payment_due_at:'2099-11-15T14:00:00.000Z'});
 const base={type:'product_save',group_id:group,name:'《マーガレット》2026年第23號｜《不可抗力のI LOVE YOU》透明卡片組',sku:'4912204231165',variant:'紙本雜誌 1 本',price_twd:160,shipping_units:1,shipping_units_confirmed:true,source_url:'https://www.neowing.co.jp/product/NEOBK-test',published:true,confirmed:true};
 return{get state(){return state},go,group,base};
}
test('editable category is persisted and returned by PL3 and official legacy storefront',()=>{
 const f=fixture();const {product_id}=f.go({...f.base,product_type:'書籍／雜誌'});
 const stored=f.state.products[0];
 assert.equal(stored.product_type,'書籍／雜誌');assert.equal(stored.price_twd,160);assert.equal(stored.shipping_units,1);
 assert.equal(publicOperationsCatalog(f.state).products[0].product_type,'書籍／雜誌');
 assert.equal(legacyOperationsCatalog(f.state).products[0].productType,'書籍／雜誌');
 f.go({...f.base,id:product_id,price_twd:160});
 assert.equal(f.state.products[0].product_type,'書籍／雜誌','non-category edits preserve explicit category');
 assert.throws(()=>f.go({...f.base,id:product_id,product_type:'<script>alert(1)</script>'}),/商品類型無效/);
 assert.equal(f.state.products[0].product_type,'書籍／雜誌');
});
test('previously published Margaret issue displays as a magazine without recreating the product',()=>{
 const f=fixture();const {product_id}=f.go({...f.base});
 delete f.state.products[0].product_type;
 assert.equal(inferProductCategory(f.state.products[0]),'書籍／雜誌');
 assert.equal(legacyOperationsCatalog(f.state).products[0].productType,'書籍／雜誌');
 f.go({...f.base,id:product_id});
 assert.equal(f.state.products[0].product_type,'書籍／雜誌');
});
test('other products do not silently become book category and existing STAR TRACE type is retained',()=>{
 const f=fixture();f.go({...f.base,name:'《進擊的巨人》Hello Kitty 玩偶',sku:'SKU-2',product_type:'絨毛玩偶'});
 assert.equal(legacyOperationsCatalog(f.state).products[0].productType,'絨毛玩偶');
 assert.equal(inferProductCategory({name:'《進擊的巨人》Hello Kitty 玩偶'}),'其他周邊');
 assert(PRODUCT_CATEGORIES.includes('書籍／雜誌'));
 assert(!PRODUCT_CATEGORIES.includes('未核實的分類'));
 const s=newOperations();s.groups.push({id:'WEVERSE-PLAVE-STARTRACE-261106',title:'PLAVE',status:'open',deadline:'2099-01-01T00:00:00Z'});
 s.products.push({id:'star',group_id:'WEVERSE-PLAVE-STARTRACE-261106',name:'按鍵吊飾',sku:'STAR',price_twd:200,shipping_units:1,shipping_units_confirmed:true,published:true,status:'available',source_url:'https://weverse.io/sales/71382'});
 assert.equal(legacyOperationsCatalog(s).products[0].productType,'按鍵吊飾');
});
