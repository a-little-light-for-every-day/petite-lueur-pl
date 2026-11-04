// PLAVE HYPERDRIVE / STAR TRACE: isolated benefit ledger and allocation rules.
// Pure functions only. No customer messages, payments, or production writes.
export const STAR_TRACE_GROUP = 'PLAVE-HYPERDRIVE-STAR-TRACE';
export const STAR_TRACE_THRESHOLD_KRW = 50000;
export const STAR_TRACE_MEMBERS = ['藝俊', '諾亞', '斑比', '銀虎', '河玟'];
export const STAR_TRACE_PRODUCTS = Object.freeze([
  ['71375',6364,'小卡套組'],['71376',16364,'壓克力立牌'],
  ['71377',4545,'隨機徽章'],['71378',8182,'隨機迷你吊飾'],
  ['71379',8182,'貼紙包'],['71380',59091,'入耳式耳機'],
  ['71381',15455,'棒球帽造型收納包吊飾'],['71382',17727,'按鍵吊飾'],
  ['71383',10909,'掛繩套組'],['71385',3636,'隨身黏毛滾輪'],
  ['71386',79091,'厚磅連帽上衣']
].map(([id,untaxed_krw,name])=>({id,untaxed_krw,name})));

const check=(v,msg)=>{if(!v)throw new Error(msg);};
const integer=(v,msg)=>check(Number.isSafeInteger(v)&&v>=0,msg);
const unique=(a,msg)=>check(new Set(a).size===a.length,msg);
const productIds=new Set(STAR_TRACE_PRODUCTS.map(p=>p.id));

// Individual eligibility is computed across the customer's eligible goods in this group.
// Official gifts are separately computed per checkout; these two numbers may differ.
export function eligibility(customerLines){
  let total=0,hoodies=0;
  for(const line of customerLines){
    check(productIds.has(String(line.product_id)),'未知 STAR TRACE 商品');
    integer(line.quantity,'商品數量錯誤');integer(line.eligible_krw,'活動認列金額錯誤');
    total+=line.eligible_krw;
    if(String(line.product_id)==='71386')hoodies+=line.quantity;
  }
  check(Number.isSafeInteger(total),'活動金額過大');
  const slots=Math.floor(total/STAR_TRACE_THRESHOLD_KRW);
  return {eligible_krw:total,slots,remainder_krw:total%STAR_TRACE_THRESHOLD_KRW,
    to_next_krw:STAR_TRACE_THRESHOLD_KRW-total%STAR_TRACE_THRESHOLD_KRW,
    hoodie_gifts:hoodies};
}

export function officialGiftCount(checkouts){
  unique(checkouts.map(x=>x.official_order_id),'官方訂單編號不可重複');
  return checkouts.map(o=>{
    check(o.official_order_id,'缺少官方訂單編號');integer(o.eligible_krw,'官方認列金額錯誤');
    return {...o,gifts_expected:Math.floor(o.eligible_krw/STAR_TRACE_THRESHOLD_KRW),
      to_next_krw:STAR_TRACE_THRESHOLD_KRW-o.eligible_krw%STAR_TRACE_THRESHOLD_KRW};
  });
}

// Slots are immutable audit subjects; one slot, one draw rank, at most one card.
export function createSlots(customers){
  const slots=[];
  unique(customers.map(x=>x.customer_order_id),'客單不可重複');
  for(const customer of customers){
    check(customer.customer_order_id,'缺少客單編號');
    check(Array.isArray(customer.preferences)&&customer.preferences.length===5,'須填五位成員志願');
    unique(customer.preferences,'成員志願不可重複');
    check(customer.preferences.every(x=>STAR_TRACE_MEMBERS.includes(x)),'成員志願錯誤');
    const e=eligibility(customer.lines);
    for(let n=1;n<=e.slots;n++)slots.push({id:`${customer.customer_order_id}:slot:${n}`,
      customer_order_id:customer.customer_order_id,preferences:[...customer.preferences],
      accepts_duplicates:customer.accepts_duplicates===true,
      accepts_nonpreferred:customer.accepts_nonpreferred===true});
  }
  return slots;
}

// The draw order must be supplied from a recorded, auditable draw. Never generate
// undisclosed pseudo-random ranks or silently assign unrequested cards.
export function allocateCards({slots,draw_order,cards,draw_evidence,adjustments=[]}){
  check(typeof draw_evidence==='string'&&draw_evidence.trim(),'缺少抽籤證據');
  unique(slots.map(x=>x.id),'分配資格重複');
  check(draw_order.length===slots.length,'抽籤順位不完整');
  unique(draw_order,'抽籤順位重複');
  check(draw_order.every(x=>slots.some(s=>s.id===x)),'抽籤含未知資格');
  const available=cards.map(c=>({...c}));
  unique(available.map(x=>x.card_id),'實寄卡片編號不可重複');
  check(available.every(x=>x.card_id&&STAR_TRACE_MEMBERS.includes(x.member)),'卡池資料錯誤');
  const allocated=[],unallocated=[];
  for(const id of draw_order){
    const slot=slots.find(s=>s.id===id);
    const existing=allocated.filter(x=>x.customer_order_id===slot.customer_order_id).map(x=>x.member);
    const chosen=slot.preferences.find(member=>available.some(c=>c.member===member&&(slot.accepts_duplicates||!existing.includes(member))));
    const cardIndex=chosen===undefined?-1:available.findIndex(c=>c.member===chosen);
    if(cardIndex<0){unallocated.push({slot_id:id,customer_order_id:slot.customer_order_id,reason:'無可分配志願卡'});continue;}
    const [card]=available.splice(cardIndex,1);
    allocated.push({slot_id:id,customer_order_id:slot.customer_order_id,card_id:card.card_id,member:card.member,rank:draw_order.indexOf(id)+1,status:'待裝箱'});
  }
  check(adjustments.length===0,'人工調整須經個別核准並另外留存調整紀錄');
  return {draw_evidence,allocated,unallocated,extra_cards:available.map(c=>({...c,status:'待分配'}))};
}

// Owner-reviewed reassignment with explicit evidence; never silently overwrite draw history.
export function adjustAllocation(allocation,change,{actor,evidence,at}){
  check(actor&&evidence&&at,'人工調整須有操作者、證據與時間');
  check(change&&typeof change==='object','調整內容不完整');
  const next=structuredClone(allocation);
  const from=next.allocated.find(x=>x.slot_id===change.slot_id);
  check(from,'找不到原配卡資格');
  const replacement=next.extra_cards.find(x=>x.card_id===change.new_card_id);
  check(replacement,'替換卡必須來自待分配卡池');
  check(from.status==='待裝箱','已裝箱或寄出的卡不可直接調整');
  next.extra_cards=next.extra_cards.filter(x=>x.card_id!==replacement.card_id);
  next.extra_cards.push({card_id:from.card_id,member:from.member,status:'待分配'});
  const before={card_id:from.card_id,member:from.member};
  from.card_id=replacement.card_id;from.member=replacement.member;
  next.adjustment_history=[...(next.adjustment_history||[]),{
    slot_id:change.slot_id,before,after:{card_id:from.card_id,member:from.member},actor,evidence,at
  }];
  return next;
}

export function updatePacking(allocation,slotId,nextStatus,{actor,evidence,at}){
  check(actor&&evidence&&at,'出貨狀態變更須有操作者、證據與時間');
  const next=structuredClone(allocation),card=next.allocated.find(x=>x.slot_id===slotId);
  check(card,'找不到配卡資格');
  const allowed={'待裝箱':'已裝箱','已裝箱':'已寄出'};
  check(allowed[card.status]===nextStatus,'配卡出貨狀態不得跳階或倒退');
  const before=card.status;card.status=nextStatus;
  next.packing_history=[...(next.packing_history||[]),{slot_id:slotId,before,after:nextStatus,actor,evidence,at}];
  return next;
}
