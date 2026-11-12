import React,{useState} from 'react';

const costFields=[
 ['japan','日本境內運費'],
 ['international','國際運費'],
 ['packaging','包材費'],
 ['tax','稅費'],
 ['domestic','台灣配送費']
];

// Keep unknown costs blank: 0 explicitly means the owner confirmed no charge.
export function SecondCostDraft({order,run,close,Modal,Input}){
 const previous=order.second_cost_draft;
 const [costs,C]=useState(Object.fromEntries(costFields.map(([kind])=>[kind,previous?.costs?.[kind]??''])));
 const [items,I]=useState(order.items.filter(l=>!['fee','service'].includes(l.fulfillment_kind)).map(l=>({item_id:l.id,name:l.name,sku:l.sku,units:l.shipping_units??''})));
 const [reference,R]=useState(previous?.shipment_reference||'');
 const [evidence,E]=useState(previous?.evidence||'');
 const [confirmed,Q]=useState(false);
 const [busy,B]=useState(false);
 const [error,X]=useState('');
 const pending=costFields.filter(([kind])=>costs[kind]==='').map(([,label])=>label);
 const knownTotal=costFields.reduce((n,[kind])=>n+(costs[kind]===''?0:Number(costs[kind])||0),0);
 async function save(event){
  event.preventDefault();B(true);X('');
  try{
   const submitted=Object.fromEntries(costFields.map(([kind])=>[kind,costs[kind]===''?null:Number(costs[kind])]));
   if(!Object.values(submitted).some(v=>v!==null))throw Error('請先確認至少一項運費');
   if(Object.values(submitted).some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0)))throw Error('費用須為非負整數');
   if(items.some(l=>!Number.isSafeInteger(Number(l.units))||Number(l.units)<1))throw Error('請逐項確認運費份數');
   await run({type:'second_cost_draft',order_id:order.id,costs:submitted,shipping_units:items.map(l=>({item_id:l.item_id,units:Number(l.units)})),shipment_reference:reference,evidence,confirmed:true});
   close();
  }catch(err){X(err.message)}finally{B(false)}
 }
 return <Modal title="暫存二補費用（不結算、不寄信）" close={close}>
  <form onSubmit={save}>
   <p className="muted">{order.id}</p>
   <p className="note">此處只保存已核定的運費份數和費用。空白代表待計，填 0 才代表已確認無此項費用。儲存不會建立或確認二補帳單、收款、付款期限或通知。</p>
   <h3>商品運費份數（不修改商品款）</h3>
   {items.map((l,i)=><div className="record" key={l.item_id}><b>{l.name}</b><small>{l.sku}</small><Input label="國際運費份數" type="number" min="1" required value={l.units} onChange={e=>I(items.map((x,j)=>i===j?{...x,units:e.target.value}:x))}/></div>)}
   <h3>已核對的分攤金額（NT$）</h3>
   <div className="formgrid">{costFields.map(([kind,label])=><Input key={kind} label={label} type="number" min="0" value={costs[kind]} onChange={e=>C({...costs,[kind]:e.target.value})}/>)}</div>
   <p><b>已知費用小計：NT${knownTotal.toLocaleString('zh-TW')}</b></p>
   <p className="note">仍待計：{pending.join('、')||'無'}。未結算，這不是顧客應付金額。</p>
   <Input label="日本集運出庫單號（選填）" value={reference} onChange={e=>R(e.target.value)}/>
   <Input label="官方運費與分攤核對依據" type="textarea" required value={evidence} onChange={e=>E(e.target.value)}/>
   <label className="check confirm"><input type="checkbox" checked={confirmed} onChange={e=>Q(e.target.checked)} required/>我確認本次僅暫存費用，不建立二補帳款及付款通知</label>
   {error&&<p role="alert" className="error">{error}</p>}
   <footer><button type="button" className="quiet" onClick={close}>返回</button><button disabled={busy||!confirmed||!evidence.trim()}>{busy?'儲存中…':'暫存運費（不結算）'}</button></footer>
  </form>
 </Modal>;
}
