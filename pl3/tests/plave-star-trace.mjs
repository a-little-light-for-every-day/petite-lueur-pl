import assert from 'node:assert/strict';
import {eligibility,officialGiftCount,createSlots,allocateCards,adjustAllocation,updatePacking} from '../plave-star-trace.js';
const lines=(amount,quantity=1)=>[{product_id:'71386',quantity,eligible_krw:amount}];
assert.deepEqual(eligibility(lines(128000)),{eligible_krw:128000,slots:2,remainder_krw:28000,to_next_krw:22000,hoodie_gifts:1});
const checkouts=officialGiftCount([{official_order_id:'A',eligible_krw:49000},{official_order_id:'B',eligible_krw:51000}]);
assert.deepEqual(checkouts.map(x=>x.gifts_expected),[0,1]); // No cross-checkout carry.
const preferences=['藝俊','諾亞','斑比','銀虎','河玟'];
const customers=[{customer_order_id:'C1',lines:lines(100000,2),preferences,accepts_duplicates:false},
  {customer_order_id:'C2',lines:lines(55000),preferences,accepts_duplicates:false}];
const slots=createSlots(customers);
assert.equal(slots.length,3);
const result=allocateCards({slots,draw_order:[slots[1].id,slots[2].id,slots[0].id],
  cards:[{card_id:'p1',member:'藝俊'},{card_id:'p2',member:'藝俊'},{card_id:'p3',member:'諾亞'},{card_id:'p4',member:'河玟'}],
  draw_evidence:'qa-recorded-draw-001'});
assert.deepEqual(result.allocated.map(x=>x.member),['藝俊','藝俊','諾亞']);
assert.deepEqual(result.extra_cards.map(x=>x.card_id),['p4']);
assert.throws(()=>allocateCards({slots,draw_order:[slots[0].id],cards:[],draw_evidence:'x'}),/順位不完整/);
assert.throws(()=>createSlots([{...customers[0],preferences:['藝俊','藝俊','斑比','銀虎','河玟']}]),/不可重複/);
const adjusted=adjustAllocation(result,{slot_id:slots[1].id,new_card_id:'p4'},{actor:'owner-qa',evidence:'approved QA swap',at:'2026-11-05T00:00:00Z'});
assert.equal(adjusted.adjustment_history.length,1);
assert.equal(adjusted.allocated[0].member,'河玟');
const packed=updatePacking(adjusted,slots[1].id,'已裝箱',{actor:'owner-qa',evidence:'box photo QA',at:'2026-11-05T00:01:00Z'});
assert.equal(packed.packing_history.length,1);
assert.throws(()=>updatePacking(packed,slots[1].id,'待裝箱',{actor:'owner-qa',evidence:'x',at:'now'}),/不得跳階或倒退/);
console.log('STAR TRACE benefit and draw allocation tests passed');
