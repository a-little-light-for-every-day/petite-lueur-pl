import React,{useState} from 'react';

const initial={owner_type:'pl_stock',lot_id:'',name:'',sku:'',shipment_reference:'',source_order:'',quantity_purchased:'',quantity_reserved:'0',shipping_units:'',goods_cost_twd:'',japan_cost_twd:'0',international_cost_twd:'',evidence:''};
const cents=value=>{
 const v=String(value).trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('成本必須是非負台幣金額，最多兩位小數');
 const [whole,fraction='']=v.split('.');
 const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(amount))throw Error('成本數字過大');
 return amount;
};
const dollars=n=>'NT$'+(Number(n||0)/100).toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2});

export function StockLots({lots=[],run}){
 const [form,F]=useState(initial),[confirmed,C]=useState(false),[busy,B]=useState(false),[error,E]=useState('');
 const set=(name,value)=>F(x=>({...x,[name]:value}));
 const inputs=[['lot_id','備貨批次唯一編號'],['name','商品完整名稱'],['sku','內部商品識別碼／已核實貨號'],['shipment_reference','集運出庫單號'],['source_order','官方採購訂單編號']];
 const costs=[['goods_cost_twd','商品實際成本（含歸屬手續費）'],['japan_cost_twd','日本境內運費分攤'],['international_cost_twd','國際運費分攤']];
 async function submit(e){
  e.preventDefault();B(true);E('');
  try{
   if(!confirmed)throw Error('請先確認原始採購與運費憑證');
   const quantity_purchased=Number(form.quantity_purchased),quantity_reserved=Number(form.quantity_reserved),shipping_units=Number(form.shipping_units);
   if(![quantity_purchased,quantity_reserved,shipping_units].every(Number.isSafeInteger))throw Error('採購、暫留、份數須為整數');
   const command={type:'stock_lot_record',owner_type:form.owner_type,lot_id:form.lot_id.trim(),name:form.name.trim(),sku:form.sku.trim(),shipment_reference:form.shipment_reference.trim(),source_order:form.source_order.trim(),quantity_purchased,quantity_reserved,shipping_units,
    goods_cost_cents:cents(form.goods_cost_twd),japan_cost_cents:cents(form.japan_cost_twd),international_cost_cents:cents(form.international_cost_twd),packaging_cost_cents:null,tax_cost_cents:null,received_quantity:0,saleable_quantity:0,evidence:form.evidence.trim(),confirmed:true};
   await run(command);F(initial);C(false);
  }catch(err){E(err.message)}finally{B(false)}
 }
 return <section className="panel"><h2>在途備貨與主購自留｜成本留存</h2>
  <p className="note">這裡是主購內部成本帳，不是對客銷售庫存。商品抵台驗貨、補齊包材與稅費、決定售價之前，所有批次的可售庫存固定為 0，不公開上架，也不產生二補或寄信。</p>
  {lots.map(l=><article className="record" key={l.id}>
   <div className="sectionhead"><h3>{l.name}</h3><span className="tag">{l.owner_type==='personal'?'主購自留':'PL 備貨'} · {l.status==='in_transit'?'國際運送中':l.status}</span></div>
   <p>{l.sku} · {l.shipment_reference} · 官方單 {l.source_order}</p>
   <p>採購 {l.quantity_purchased} 件 · 暫留 {l.quantity_reserved} 件 · <b>台灣可售 0 件</b> · 國際 {l.shipping_units} 份</p>
   <p>商品 {dollars(l.goods_cost_cents)} ＋ 日本境內 {dollars(l.japan_cost_cents)} ＋ 國際 {dollars(l.international_cost_cents)} ＝ <b>已知成本 {dollars(l.known_cost_cents)}</b></p>
   <small>包材費、稅費：待抵台核實 · 成本尚未結清 · {l.evidence}</small>
  </article>)}
  {!lots.length&&<p className="empty">PL3 尚無內部備貨批次紀錄。</p>}
  <details><summary>＋登錄已核實在途備貨（不公開、不結算）</summary>
   <form onSubmit={submit}>
    <label className="field"><span>持有目的</span><select value={form.owner_type} onChange={e=>set('owner_type',e.target.value)}><option value="pl_stock">PL 備貨（將來可轉現貨）</option><option value="personal">主購自留（不轉銷售庫存）</option></select></label>
    <div className="formgrid">{inputs.map(([key,label])=><label className="field" key={key}><span>{label}</span><input required value={form[key]} onChange={e=>set(key,e.target.value)}/></label>)}
    {[['quantity_purchased','實際採購數量',1],['quantity_reserved','已暫留／未可售數量',0],['shipping_units','本批國際運費份數',1]].map(([key,label,min])=><label className="field" key={key}><span>{label}</span><input type="number" min={min} step="1" required value={form[key]} onChange={e=>set(key,e.target.value)}/></label>)}</div>
    <div className="formgrid">{costs.map(([key,label])=><label className="field" key={key}><span>{label}（NT$）</span><input required inputMode="decimal" value={form[key]} onChange={e=>set(key,e.target.value)}/></label>)}</div>
    <label className="field"><span>採購與運費原始證據（Notion／Google／官方憑證）</span><textarea required minLength={8} value={form.evidence} onChange={e=>set('evidence',e.target.value)}/></label>
    <label className="check confirm"><input type="checkbox" required checked={confirmed} onChange={e=>C(e.target.checked)}/>我已核對成本及暫留數量，並確認本次只登錄在途資料，可售量為零、不發通知</label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button disabled={busy||!confirmed}>{busy?'儲存中…':'保存內部在途成本'}</button>
   </form>
  </details>
 </section>;
}
