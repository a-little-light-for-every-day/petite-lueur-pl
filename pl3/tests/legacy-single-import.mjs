import test from 'node:test';
import assert from 'node:assert/strict';
import{newOperations,applyOperation}from'../operations-domain.js';

const command={type:'legacy_order_import_single',confirmed:true,order_id:'PL-261105-491966',name:'測試姓名',email:'test@example.com',group_id:'star-trace',source_url:'https://www.notion.so/p/40f52485b660817ab934d40ac0972633',source_revision:'2026-11-05T14:08:35.874Z',source_status:'訂購申請待確認',source_payment_status:'尚未通知付款',expected_goods_twd:550,items:[{id:'WEB:test-uuid:01',name:'TYPE B',sku:'WV-PLAVE-71382-B',variant:'紅／粉色',quantity:1,unit_price_twd:550,shipping_units:2}]};
const original=()=>{const s=newOperations();s.groups.push({id:'star-trace',status:'open'});return s};

test('imports one preserved-ID order without invoices, notices or modifying source state',()=>{
 const s=original();const r=applyOperation(s,command,{now:'2026-11-06T00:00:00Z',id:'test'});
 assert.equal(s.orders.length,0);assert.equal(r.state.orders.length,1);
 const o=r.state.orders[0];assert.equal(o.id,command.order_id);assert.equal(o.email,command.email);assert.equal(o.name,command.name);assert.equal(o.goods_twd,550);assert.equal(o.items[0].id,command.items[0].id);assert.equal(o.status,'review_pending');assert.equal(o.source_url,command.source_url);assert.equal(o.source_revision,command.source_revision);
 assert.deepEqual(r.state.invoices,[]);assert.deepEqual(r.state.notices,[]);
 assert.throws(()=>applyOperation(r.state,command),/禁止覆寫或重複匯入/);
});
test('rejects inconsistent totals, missing evidence, and duplicate fulfillment keys',()=>{
 const s=original();
 assert.throws(()=>applyOperation(s,{...command,expected_goods_twd:500}),/總額不符/);
 assert.throws(()=>applyOperation(s,{...command,source_url:'https://example.com'}),/Notion/);
 assert.throws(()=>applyOperation(s,{...command,source_payment_status:'已通知付款'}),/尚未通知付款/);
 s.orders.push({id:'another-order',items:[{id:command.items[0].id}]});
 assert.throws(()=>applyOperation(s,command),/履約項目識別碼已存在/);
});
