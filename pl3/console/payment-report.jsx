import React,{useState} from 'react';

// Customer reports are evidence for reconciliation, never proof of cleared funds.
export function PaymentReport({order,token,api,Input,Modal,onDone}){
 const [v,V]=useState({phase:order.invoices?.some(x=>x.phase==='first')?'first':order.invoices?.some(x=>x.phase==='second')?'second':'first',amount_twd:'',method:'台新銀行',paid_at:'',last5:'',note:''});
 const [key]=useState(()=>crypto.randomUUID()),[busy,B]=useState(false),[err,E]=useState('');
 const set=(name,value)=>V(old=>({...old,[name]:value}));
 async function submit(e){
  e.preventDefault();B(true);E('');
  try{
   if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.paid_at))throw Error('請填實際付款日期與時間');
   const paidAt=new Date(v.paid_at+':00+08:00');
   if(!Number.isFinite(paidAt.getTime()))throw Error('付款日期與時間無效');
   await api('/api/operations/payment-report',{key,command:{...v,order_id:order.id,amount_twd:Number(v.amount_twd),paid_at:paidAt.toISOString()}},token);
   onDone();
  }catch(e){E(e.message)}finally{B(false)}
 }
 return <Modal title={'付款回報｜'+order.id} close={onDone}>
  <form onSubmit={submit}>
   <Input label="付款階段" options={[["first","一補｜商品款"],["second","二補｜運費及其他分攤"]]} value={v.phase} onChange={e=>set('phase',e.target.value)} required/>
   <Input label="實際付款金額（台幣）" type="number" min="1" step="1" value={v.amount_twd} onChange={e=>set('amount_twd',e.target.value)} required/>
   <Input label="付款方式" options={[["台新銀行","台新銀行（812）轉帳"],["中國信託無卡存款","中信無卡存款"],["台灣 Pay","台灣 Pay"]]} value={v.method} onChange={e=>set('method',e.target.value)} required/>
   <Input label="付款日期與時間（台灣時間）" type="datetime-local" value={v.paid_at} onChange={e=>set('paid_at',e.target.value)} required/>
   <Input label="轉出帳號末五碼（適用時填寫；無卡存款可留空）" inputMode="numeric" pattern="[0-9]{5}" maxLength="5" value={v.last5} onChange={e=>set('last5',e.target.value)}/>
   <Input label="其他核帳備註（選填）" type="textarea" value={v.note} onChange={e=>set('note',e.target.value)}/>
   <p className="note">提交後狀態為「待核帳」；需由主購查證實際入帳後，才會標示已收款。不需上傳付款截圖。</p>
   {!(order.invoices||[]).some(b=>b.phase===v.phase&&b.finalized)&&<p className="note">此階段帳款尚未完成建立，回報可以先送出，主購核對時仍需補齊帳款資料。</p>}
   {err&&<p className="error" role="alert">{err}</p>}
   <button disabled={busy}>{busy?'送出中…':'送出付款回報'}</button>
  </form>
 </Modal>;
}
