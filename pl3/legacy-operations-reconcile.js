// Owner-reviewed legacy completion. Never changes bills, funds, identity or existing lines.
export function completeLegacyOperations(s,c,{now,id}){
 const check=(v,m)=>{if(!v)throw Object.assign(Error(m),{status:409});};
 check(c.confirmed===true&&Array.isArray(c.rows)&&c.rows.length>0&&c.rows.length<=52,'請確認核對後的歷史資料');
 check(new Set(c.rows.map(x=>x.order_id)).size===c.rows.length,'歷史客單不可重複');
 let lines=0,groups=0;
 for(const r of c.rows){const o=s.orders.find(x=>x.id===r.order_id);check(o&&o.source_url===r.expected_source_url&&o.goods_twd===r.expected_goods_twd,'歷史來源或商品總額已變動');check(typeof r.evidence==='string'&&r.evidence.length>=15&&r.evidence.length<=5000,'缺少歷史核對證據');
  if(r.group){check(o.group_id==='legacy-unassigned','已有團次不可由歷史補全覆蓋');check(r.group.id&&r.group.title&&r.group.source_url,'團次缺來源');let g=s.groups.find(x=>x.id===r.group.id);if(!g){g={...r.group,status:'closed',auto_close:false,deadline:null,payment_due_at:null};s.groups.push(g);groups++;}o.group_id=g.id;o.group_evidence=r.evidence;}
  if(r.group_id){check(o.group_id==='legacy-unassigned'&&s.groups.some(g=>g.id===r.group_id),'團次已有變動或不存在');o.group_id=r.group_id;o.group_evidence=r.evidence;}
  if(r.items){check(!o.items.length&&r.items.length>0&&r.items.length<=50,'只可補入缺少的歷史明細');const known=r.items.every(x=>Number.isSafeInteger(x.unit_price_twd)&&x.unit_price_twd>=0);check(!known||r.items.reduce((n,x)=>n+x.quantity*x.unit_price_twd,0)===o.goods_twd,'品項金額與原商品款不符');
   o.items=r.items.map((x,i)=>{check(typeof x.name==='string'&&x.name.trim()&&x.name.length<=300&&Number.isSafeInteger(x.quantity)&&x.quantity>0,'歷史品項格式錯誤');check(x.unit_price_twd===null||Number.isSafeInteger(x.unit_price_twd)&&x.unit_price_twd>=0,'未知單價須為null');check(x.shipping_units===null||Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0,'運費份數格式錯誤');let prior=x.quantity;const stages={};for(const k of ['purchased','overseas','transit','taiwan','shipped','delivered']){const v=x[k]??0;check(Number.isSafeInteger(v)&&v>=0&&v<=prior,'歷史履約數量不一致');stages[k]=v;prior=v;}return{id:id+':'+o.id+':'+i,name:x.name.trim(),sku:String(x.sku||''),variant:String(x.variant||''),quantity:x.quantity,unit_price_twd:x.unit_price_twd,shipping_units:x.shipping_units,fulfillment_kind:'physical',...stages,hold:null,source_evidence:r.evidence};});lines+=o.items.length;o.source_issues=(o.source_issues||[]).filter(x=>x!=='ITEM_RELATION_MISSING'&&(!known||!['ITEM_AMOUNT_MISMATCH','HISTORICAL_PRICE_UNKNOWN'].includes(x)));if(!known&&!o.source_issues.includes('HISTORICAL_PRICE_UNKNOWN'))o.source_issues.push('HISTORICAL_PRICE_UNKNOWN');}
  o.legacy_reconciliation={at:now,evidence:r.evidence,remaining:r.remaining||[],source_checked_at:r.source_checked_at||now};
 }
 return{orders:c.rows.length,lines,groups};
}
