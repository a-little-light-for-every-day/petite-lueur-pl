import React,{useState} from 'react';

// Intentional one-order form. Historical funds are marked as already accounted for,
// never entered as new receipts or allocations in the current period.
export function LegacyPaymentReconcile({order,run,close}){
 const [form,F]=useState({firstPaidAt:'',bankLast5:'',firstEvidence:'',international:'',domestic:'',other:'0',
  netPayout:'',deduction:'',secondPaidAt:'',tracking:'',secondEvidence:'',deductionConfirmed:false,confirmed:false});
 const [error,E]=useState(''),[busy,B]=useState(false);
 const set=(key,value)=>F(v=>({...v,[key]:value}));
 const numeric=key=>Number(form[key]);
 const first=order.goods_twd;
 const second=numeric('international')+numeric('domestic')+numeric('other');
 async function submit(e){
  e.preventDefault();E('');B(true);
  try{
   await run({type:'legacy_payment_reconcile_single',confirmed:form.confirmed,order_id:order.id,
    expected_source_url:order.source_url,expected_goods_twd:first,
    first:{amount_twd:first,paid_at:form.firstPaidAt,bank_last5:form.bankLast5,evidence:form.firstEvidence},
    second:{international_twd:numeric('international'),domestic_twd:numeric('domestic'),other_twd:numeric('other'),
     net_payout_twd:numeric('netPayout'),platform_deduction_twd:numeric('deduction'),paid_at:form.secondPaidAt,
     tracking:form.tracking,evidence:form.secondEvidence,deduction_detail_confirmed:form.deductionConfirmed}});
   close();
  }catch(err){E(err.message)}finally{B(false)}
 }
 const field=(key,label,type='text')=><label className="field" key={key}><span>{label}</span>
  <input type={type} min={type==='number'?0:undefined} value={form[key]} required onChange={e=>set(key,e.target.value)}/></label>;
 const evidence=(key,label)=><label className="field" key={key}><span>{label}</span>
  <textarea rows="3" value={form[key]} required onChange={e=>set(key,e.target.value)}/></label>;
 return <div className="shade"><section className="modal" role="dialog" aria-modal="true" aria-label="單筆歷史帳款核對">
  <header><h2>單筆歷史帳款核對</h2><button type="button" className="quiet" onClick={close}>關閉 ✕</button></header>
  <p className="muted">{order.id} · 原商品款 NT${first.toLocaleString('zh-TW')}</p>
  <p className="note">僅補記原已收到的歷史款項，不新增本期收入、銀行收款、分配、通知或寄件。不核實的平台扣款項目會明確保留待對帳。</p>
  <form onSubmit={submit}>
   <h3>原第一階段（已核實舊款）</h3>
   <div className="formgrid">{field('firstPaidAt','原入帳日（YYYY-MM-DD）','date')}{field('bankLast5','原轉帳帳號末五碼')}</div>
   {evidence('firstEvidence','原匯款／銀行核對來源（至少20字）')}
   <h3>原第二階段（平台代收）</h3>
   <div className="formgrid">
    {field('international','國際運費','number')}{field('domestic','台灣配送費','number')}{field('other','其他已核費用','number')}
    {field('netPayout','平台淨撥入帳','number')}{field('deduction','平台扣除金額','number')}
    {field('secondPaidAt','平台實撥日','date')}{field('tracking','原寄件物流單號')}
   </div>
   <p className="note">二補總額 NT${Number.isFinite(second)?second.toLocaleString('zh-TW'):'—'}；淨撥＋扣款 NT${(numeric('netPayout')+numeric('deduction')).toLocaleString('zh-TW')}，兩者須相等。</p>
   {evidence('secondEvidence','平台已入帳核對依據（至少20字）')}
   <label className="check"><input type="checkbox" checked={form.deductionConfirmed} onChange={e=>set('deductionConfirmed',e.target.checked)}/>已有平台明細證明扣款的具體名目（未勾選只標金額，保留待核對）</label>
   <label className="check"><input type="checkbox" required checked={form.confirmed} onChange={e=>set('confirmed',e.target.checked)}/>我已逐項核對原收款與平台入帳，僅補正這筆歷史帳款，且不重複新增收入或寄送付款通知</label>
   {error&&<p className="error">{error}</p>}
   <button disabled={busy||!form.confirmed||second<=0||numeric('netPayout')+numeric('deduction')!==second}>{busy?'執行中…':'核對並儲存歷史帳款'}</button>
  </form>
 </section></div>;
}
