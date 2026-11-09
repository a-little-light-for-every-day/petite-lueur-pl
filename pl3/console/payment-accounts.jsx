import React,{useState} from 'react';
import './payment-accounts.css';

export function PaymentAccountsSettings({config,run}){
 const saved=config?.payment_accounts||{};
 const [bank,B]=useState(saved.bank_transfer||''),[ctbc,C]=useState(saved.ctbc_cash||'');
 const [visible,V]=useState(false),[busy,U]=useState(false),[message,M]=useState('');
 async function save(e){
  e.preventDefault();M('');U(true);
  try{
   if(!/^\d{10,16}$/.test(bank)||!/^\d{10,16}$/.test(ctbc))throw Error('兩組帳號皆須為 10～16 位數字');
   await run({type:'payment_accounts_config',bank_transfer:bank,ctbc_cash:ctbc,confirmed:true});
   M('已儲存。符合付款條件的客人可在驗證 Email 後選擇方式並查看帳號。');
  }catch(e){M(e.message)}finally{U(false)}
 }
 return <section className="panel" aria-label="收款帳號設定">
  <div className="sectionhead"><h2>收款帳號設定</h2><button type="button" className="secondary" onClick={()=>V(!visible)}>{visible?'隱藏帳號':'顯示帳號'}</button></div>
  <p className="note">僅於客人驗證訂購 Email、帳款已正式通知、金額確認且尚未付款與逾期時，才顯示所選帳號。修改設定不會寄信、不會自動核帳。</p>
  <form onSubmit={save}>
   <div className="formgrid">
    <label className="field"><span>銀行匯款｜台新銀行（812）</span><input type={visible?'text':'password'} inputMode="numeric" autoComplete="off" minLength="10" maxLength="16" pattern="[0-9]{10,16}" required value={bank} onChange={e=>B(e.target.value)}/></label>
    <label className="field"><span>無卡存款｜中國信託（822）</span><input type={visible?'text':'password'} inputMode="numeric" autoComplete="off" minLength="10" maxLength="16" pattern="[0-9]{10,16}" required value={ctbc} onChange={e=>C(e.target.value)}/></label>
   </div>
   <button type="submit" disabled={busy}>{busy?'儲存中…':'儲存兩組收款帳號'}</button>
   {message&&<p role="status" className="note">{message}</p>}
  </form>
 </section>;
}

export function PaymentInstructions({options,amount,onReport}){
 const [method,M]=useState(''),[copied,C]=useState('');
 if(!options?.length)return <p className="note">目前沒有可顯示的付款帳號。請以正式付款通知為準；帳款確認並通知後，才可在已驗證的訂單中選擇付款方式查看帳號。取消、缺貨及尚未核定的訂單不會顯示收款資料。</p>;
 const selected=options.find(o=>o.method===method);
 async function copy(){
  if(!selected)return;
  try{await navigator.clipboard.writeText(selected.account);C('帳號已複製')}catch{C('請長按帳號手動複製')}
 }
 return <section className="payment-instructions" aria-label="付款帳號">
  <strong>選擇付款方式，查看收款帳號</strong>
  <label className="field"><span>付款方式</span><select value={method} onChange={e=>{M(e.target.value);C('')}}>
   <option value="">請選擇</option>{options.map(o=><option value={o.method} key={o.method}>{o.method==='銀行匯款'?'銀行匯款（台新銀行）':o.method}</option>)}
  </select></label>
  {selected&&<div className="account-detail">
   <small>銀行名稱／代碼</small><b>{selected.bank}（{selected.bank_code}）</b>
   <small>收款帳號</small><strong className="account-number">{selected.account}</strong>
   <div className="actions"><button type="button" className="secondary" onClick={copy}>複製帳號</button><button type="button" onClick={()=>onReport(selected.method)}>我已付款，前往回報</button></div>
   {copied&&<small role="status">{copied}</small>}
   <small>本階段尚待付款 {amount==null?'金額待確認':'NT$'+Number(amount).toLocaleString('zh-TW')}；請依本次通知金額匯款，勿將不同階段款項自行合併。</small>
  </div>}
  <small>台灣 Pay（合庫 TWQR）如需使用，請向官方索取當次付款資訊。</small>
 </section>;
}
