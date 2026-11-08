import React,{useState} from 'react';
import {readyAvailable,READY_LOCATIONS} from '../ready-inventory.js';
const defaults={name:'',variant:'',sku:'',official_order_id:'',source_url:'',image_url:'',location:'purchased_preorder',quantity:1,price_twd:0,shipping_units:1,official_image:false,approved:false,published:false,evidence:''};
const labels={taiwan_stock:'台灣現貨',japan_stock:'日本倉庫現貨',purchased_preorder:'已預購・待官方出貨'};
export function ReadyInventoryDesk({state,run}){
 const [editing,E]=useState(null),[form,F]=useState(defaults),[busy,B]=useState(false),[error,X]=useState(''),[message,M]=useState('');
 const stocks=state.ready_stock||[],claims=state.ready_claims||[];
 const open=item=>{E(item?.id||'new');F(item?{...item}:defaults);X('');M('');};
 const set=(k,v)=>F(old=>({...old,[k]:v}));
 async function save(e){e.preventDefault();B(true);X('');try{await run({type:'ready_stock_save',...(editing!=='new'?{id:editing}:{}),...form,quantity:Number(form.quantity),price_twd:Number(form.price_twd),shipping_units:form.shipping_units===''?null:Number(form.shipping_units),confirmed:true});E(null);M('庫存資料已保存；公開狀態以核准欄位和可認領數量為準。');}catch(err){X(err.message)}finally{B(false)}}
 return <section className="panel" aria-label="PL 備貨庫存管理">
  <div className="sectionhead"><div><h2>現貨＆已預購｜備貨庫存</h2><p className="muted">僅登錄 PL 已實際購入的備貨；自留、贈禮、已售客單和未確認到貨數量不得算入。資料不會再次建立採購支出。</p></div><button onClick={()=>open()}>＋新增備貨</button></div>
  {message&&<p className="note">{message}</p>}
  {stocks.map(item=>{const available=readyAvailable(state,item),held=claims.filter(x=>x.stock_id===item.id&&x.status==='held').reduce((n,x)=>n+x.quantity,0),sold=claims.filter(x=>x.stock_id===item.id&&x.status==='confirmed').reduce((n,x)=>n+x.quantity,0);return <article className="record" key={item.id}>
    <div className="sectionhead"><h3>{item.name} {item.variant}</h3><span className="tag">{item.published&&item.approved&&item.official_image&&available>0?'公開可認領':'未公開／不可認領'}</span></div>
    <p>{labels[item.location]} · NT${item.price_twd.toLocaleString('zh-TW')} · 官方單 {item.official_order_id}</p>
    <p>總備貨 {item.quantity}｜暫保留 {held}｜已確認認領 {sold}｜可認領 {available}</p>
    <button className="secondary" onClick={()=>open(item)}>編輯庫存與上下架</button>
  </article>})}
  {!stocks.length&&<p className="empty">尚未建立經核實的 PL 備貨商品。</p>}
  <h3>待主購確認的認領</h3>
  {claims.filter(x=>x.status==='held').map(claim=>{const order=state.orders.find(x=>x.id===claim.order_id),stock=stocks.find(x=>x.id===claim.stock_id);return <article className="record" key={claim.id}><b>{stock?.name||claim.stock_id} ×{claim.quantity}</b><p>{claim.order_id} · {order?.email}</p><p className="note">主購核實後，至「訂單與顧客」審核承接；取消則釋出原本保留的數量。</p><button className="secondary" onClick={async()=>{const reason=window.prompt('請輸入取消認領與釋出庫存的原因');if(!reason?.trim())return;try{await run({type:'ready_claim_release',order_id:claim.order_id,reason,confirmed:true})}catch(err){X(err.message)}}}>取消認領並釋出庫存</button></article>})}
  {editing&&<div className="shade"><section className="modal" role="dialog" aria-modal="true" aria-label="備貨庫存編輯"><header><h2>{editing==='new'?'新增已購備貨':'編輯已購備貨'}</h2><button className="quiet" onClick={()=>E(null)}>關閉 ✕</button></header>
   <form onSubmit={save}><div className="formgrid">
    {[["name","商品名稱"],["variant","款式／規格"],["sku","官方貨號"],["official_order_id","原官方訂單編號"],["source_url","官方商品來源網址"],["image_url","官方原圖網址"],["evidence","官方購入與可售數量核對依據"]].map(([k,label])=><label className="field" key={k}><span>{label}</span><input value={form[k]||''} required={!['variant','image_url'].includes(k)} onChange={e=>set(k,e.target.value)}/></label>)}
    <label className="field"><span>商品所在地</span><select value={form.location} onChange={e=>set('location',e.target.value)}>{READY_LOCATIONS.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    {[["quantity","PL 備貨總數（不得包含自留、已售）"],["price_twd","台幣商品款"],["shipping_units","國際運費份數（待實算可留空）"]].map(([k,label])=><label className="field" key={k}><span>{label}</span><input type="number" min={k==='quantity'?0:1} value={form[k]??''} onChange={e=>set(k,e.target.value)}/></label>)}
   </div>
   <label className="check"><input type="checkbox" checked={form.official_image} onChange={e=>set('official_image',e.target.checked)}/>圖片確認為官方原圖（無圖亦須核實來源）</label>
   <label className="check"><input type="checkbox" checked={form.approved} onChange={e=>set('approved',e.target.checked)}/>已核對採購證明、成本歸屬及可售數量</label>
   <label className="check"><input type="checkbox" checked={form.published} onChange={e=>set('published',e.target.checked)}/>開放客人申請認領（不能超過可售數）</label>
   {error&&<p className="error">{error}</p>}<button disabled={busy}>{busy?'儲存中…':'確認並保存庫存'}</button>
   </form></section></div>}
  {error&&!editing&&<p className="error">{error}</p>}
 </section>;
}
